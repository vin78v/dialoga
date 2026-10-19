package it.dialoga.security.project;

import static org.junit.jupiter.api.Assertions.*;
import it.dialoga.security.DialogaUser;
import it.dialoga.security.authorization.ProjectAction;
import it.dialoga.security.authorization.ProjectAuthorizationService;
import it.dialoga.security.organization.OrganizationService;
import it.dialoga.security.team.OrganizationTeamService;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.context.annotation.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.server.ResponseStatusException;

/** Il ripristino riapre il progetto, senza ricreare autorizzazioni revocate nel frattempo. */
@EnabledIfEnvironmentVariable(named = "DIALOGA_TEST_DB_URL", matches = ".+")
class ProjectRestoreDatabaseTest {
    private AnnotationConfigApplicationContext context;
    private JdbcTemplate jdbc;
    private ProjectService projects;
    private OrganizationService organizations;
    private ProjectMembershipService memberships;
    private OrganizationTeamService team;
    private ProjectAuthorizationService authorization;
    private TransactionTemplate transactions;
    private DialogaUser owner, admin, member, outsider;
    private UUID org;
    private ProjectService.Project project;
    private final List<UUID> orgIds = new ArrayList<>();

    @Configuration
    static class Config {
        @Bean ProjectMembershipService memberships(JdbcTemplate jdbc) { return new ProjectMembershipService(jdbc); }
        @Bean OrganizationTeamService team(JdbcTemplate jdbc) { return new OrganizationTeamService(jdbc); }
        @Bean ProjectAuthorizationService authorization(JdbcTemplate jdbc) { return new ProjectAuthorizationService(jdbc); }
    }

    @BeforeEach void prepare() {
        // Usiamo il ruolo runtime senza BYPASSRLS: un accesso cross tenant deve
        // fallire anche quando i dati esistono davvero nel database di prova.
        context = new AnnotationConfigApplicationContext(ProjectDatabaseTest.Config.class, Config.class);
        jdbc = context.getBean(JdbcTemplate.class);
        projects = context.getBean(ProjectService.class);
        organizations = context.getBean(OrganizationService.class);
        memberships = context.getBean(ProjectMembershipService.class);
        team = context.getBean(OrganizationTeamService.class);
        authorization = context.getBean(ProjectAuthorizationService.class);
        transactions = new TransactionTemplate(context.getBean(DataSourceTransactionManager.class));
        assertFalse(jdbc.queryForObject("SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user", Boolean.class));
        assertTrue(jdbc.queryForObject("SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = 'dialoga.project'::regclass", Boolean.class));
        owner = user(); admin = user(); member = user(); outsider = user();
        org = organization();
        tenant(org, () -> jdbc.update("""
                INSERT INTO dialoga.organization_membership (organization_id, user_id, role)
                VALUES (?, ?, 'ADMIN'), (?, ?, 'MEMBER')
                """, org, admin.id(), org, member.id()));
        project = projects.create(owner, org, "Project name", "project", "Description");
    }

    private DialogaUser user() {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO dialoga.app_user (id, email) VALUES (?, ?)", id, id + "@example.test");
        return new DialogaUser(id, id + "@example.test", null, null);
    }
    private UUID organization() {
        UUID id = organizations.create(owner, "Restore test", "restore-" + UUID.randomUUID()).id();
        orgIds.add(id); return id;
    }
    private void tenant(UUID id, Runnable action) {
        transactions.executeWithoutResult(tx -> {
            jdbc.queryForObject("SELECT set_config('app.organization_id', ?, true)", String.class, id.toString());
            action.run();
        });
    }
    private void status(int expected, Runnable action) {
        assertEquals(expected, assertThrows(ResponseStatusException.class, action::run).getStatusCode().value());
    }
    private void inaccessible(DialogaUser actor) {
        status(404, () -> projects.listArchived(actor, org));
        status(404, () -> projects.restore(actor, org, project.id()));
    }
    private UUID seedPrivileges(UUID projectId, DialogaUser target) {
        AtomicReference<UUID> membership = new AtomicReference<>();
        tenant(org, () -> {
            UUID id = jdbc.queryForObject("""
                    INSERT INTO dialoga.project_membership (organization_id, project_id, user_id, role)
                    VALUES (?, ?, ?, 'VIEWER') RETURNING id
                    """, UUID.class, org, projectId, target.id());
            membership.set(id);
            jdbc.update("""
                    INSERT INTO dialoga.project_permission (organization_id, project_id, project_membership_id, permission)
                    VALUES (?, ?, ?, 'CONVERSATION_READ')
                    """, org, projectId, id);
            jdbc.update("""
                    INSERT INTO dialoga.project_user_permission (organization_id, project_id, user_id, permission, granted_by_user_id)
                    VALUES (?, ?, ?, 'PERSONAL_DATA_EXPORT', ?)
                    """, org, projectId, target.id(), owner.id());
        });
        return membership.get();
    }
    private void assertPrivileges(UUID projectId, DialogaUser target, UUID membershipId, boolean present) {
        tenant(org, () -> {
            assertEquals(membershipId, jdbc.queryForObject("SELECT id FROM dialoga.project_membership WHERE organization_id = ? AND project_id = ? AND user_id = ?", UUID.class, org, projectId, target.id()));
            assertEquals(present ? "ACTIVE" : "SUSPENDED", jdbc.queryForObject("SELECT status FROM dialoga.project_membership WHERE id = ?", String.class, membershipId));
            assertEquals(present ? 1 : 0, jdbc.queryForObject("SELECT count(*) FROM dialoga.project_permission WHERE project_membership_id = ?", Integer.class, membershipId));
            assertEquals(present ? 1 : 0, jdbc.queryForObject("SELECT count(*) FROM dialoga.project_user_permission WHERE organization_id = ? AND project_id = ? AND user_id = ?", Integer.class, org, projectId, target.id()));
        });
    }
    private void denied(DialogaUser actor) {
        assertThrows(AccessDeniedException.class, () -> authorization.require(actor, org, project.id(), ProjectAction.VIEW));
    }

    @AfterEach void cleanup() {
        try {
            for (UUID id : orgIds) tenant(id, () -> {
                // Anche la pulizia resta soggetta a RLS e rispetta l'ordine delle FK.
                jdbc.update("DELETE FROM dialoga.project_permission WHERE organization_id = ?", id);
                jdbc.update("DELETE FROM dialoga.project_user_permission WHERE organization_id = ?", id);
                jdbc.update("DELETE FROM dialoga.organization_permission WHERE organization_id = ?", id);
                jdbc.update("DELETE FROM dialoga.project_membership WHERE organization_id = ?", id);
                jdbc.update("DELETE FROM dialoga.project WHERE organization_id = ?", id);
                jdbc.update("UPDATE dialoga.organization SET status = 'DELETED' WHERE id = ?", id);
                jdbc.update("DELETE FROM dialoga.organization_membership WHERE organization_id = ?", id);
                jdbc.update("DELETE FROM dialoga.organization WHERE id = ?", id);
            });
            jdbc.update("DELETE FROM dialoga.app_user WHERE id IN (?, ?, ?, ?)", owner.id(), admin.id(), member.id(), outsider.id());
        } finally { context.close(); }
    }

    @Test void archivedListIsSeparateFromActiveProjectsAndNormalDetail() {
        var sibling = projects.create(owner, org, "Active sibling", "active-sibling", null);
        assertTrue(projects.listArchived(owner, org).isEmpty());
        projects.archive(owner, org, project.id());
        var archived = new ProjectService.Project(project.id(), org, project.name(), project.slug(), project.description(), "ARCHIVED");
        assertEquals(List.of(archived), projects.listArchived(owner, org));
        assertEquals(List.of(archived), projects.listArchived(admin, org));
        assertEquals(List.of(sibling), projects.list(owner, org));
        status(404, () -> projects.get(owner, org, project.id()));
        status(404, () -> projects.get(admin, org, project.id()));
        status(409, () -> projects.create(owner, org, "Duplicate slug", project.slug(), null));
    }

    @Test void ownerAndAdminRestoreIdempotentlyWithoutChangingIdentityOrMetadata() {
        projects.archive(owner, org, project.id());
        assertEquals(project, projects.restore(owner, org, project.id()));
        assertEquals(project, projects.restore(admin, org, project.id()));
        assertEquals(project, projects.get(owner, org, project.id()));
        assertTrue(projects.listArchived(owner, org).isEmpty());
        assertEquals(List.of(project), projects.list(admin, org));
        tenant(org, () -> assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM dialoga.project WHERE organization_id = ?", Integer.class, org)));
    }

    @Test void regularMemberAndProjectManagerCannotListArchivesOrRestore() {
        status(403, () -> projects.listArchived(member, org));
        status(403, () -> projects.restore(member, org, project.id()));
        memberships.assign(owner, org, project.id(), member.id(), "MANAGER");
        projects.archive(owner, org, project.id());
        status(403, () -> projects.listArchived(member, org));
        status(403, () -> projects.restore(member, org, project.id()));
        assertEquals("ARCHIVED", projects.listArchived(owner, org).get(0).status());
    }

    @Test void outsidersAndMismatchedTenantsCannotReadOrRestoreExistingProjects() {
        UUID otherOrg = organization();
        var otherProject = projects.create(owner, otherOrg, "Other project", "other", null);
        projects.archive(owner, org, project.id());
        projects.archive(owner, otherOrg, otherProject.id());
        inaccessible(outsider);
        status(404, () -> projects.restore(owner, otherOrg, project.id()));
        status(404, () -> projects.restore(owner, org, otherProject.id()));
        status(404, () -> projects.restore(owner, org, UUID.randomUUID()));
        status(404, () -> projects.listArchived(owner, UUID.randomUUID()));
        assertEquals(List.of(project.id()), projects.listArchived(owner, org).stream().map(ProjectService.Project::id).toList());
        assertEquals(List.of(otherProject.id()), projects.listArchived(owner, otherOrg).stream().map(ProjectService.Project::id).toList());
    }

    @Test void inactiveAccountMembershipOrOrganizationCannotListOrRestoreArchives() {
        projects.archive(owner, org, project.id());
        jdbc.update("UPDATE dialoga.app_user SET status = 'SUSPENDED' WHERE id = ?", admin.id());
        inaccessible(admin);
        jdbc.update("UPDATE dialoga.app_user SET status = 'ACTIVE' WHERE id = ?", admin.id());
        tenant(org, () -> jdbc.update("UPDATE dialoga.organization_membership SET status = 'SUSPENDED' WHERE organization_id = ? AND user_id = ?", org, admin.id()));
        inaccessible(admin);
        tenant(org, () -> jdbc.update("UPDATE dialoga.organization_membership SET status = 'ACTIVE' WHERE organization_id = ? AND user_id = ?", org, admin.id()));
        tenant(org, () -> jdbc.update("UPDATE dialoga.organization SET status = 'SUSPENDED' WHERE id = ?", org));
        inaccessible(owner);
        inaccessible(admin);
        tenant(org, () -> jdbc.update("UPDATE dialoga.organization SET status = 'ACTIVE' WHERE id = ?", org));
        assertEquals("ARCHIVED", projects.listArchived(owner, org).get(0).status());
    }

    @Test void validAssignmentsAndBothGrantSourcesResumeWithoutTouchingSiblingProject() {
        UUID membershipId = seedPrivileges(project.id(), member);
        var sibling = projects.create(owner, org, "Sibling", "sibling", null);
        UUID siblingMembership = seedPrivileges(sibling.id(), member);
        authorization.require(member, org, project.id(), ProjectAction.EXPORT_CONVERSATIONS);
        projects.archive(owner, org, project.id());
        denied(member);
        projects.restore(owner, org, project.id());
        assertPrivileges(project.id(), member, membershipId, true);
        assertPrivileges(sibling.id(), member, siblingMembership, true);
        authorization.require(member, org, project.id(), ProjectAction.EXPORT_CONVERSATIONS);
        authorization.require(member, org, sibling.id(), ProjectAction.EXPORT_CONVERSATIONS);
        assertEquals(project, projects.get(member, org, project.id()));
    }

    @Test void restoreDoesNotReactivateRevokedAssignmentsOrInactiveGlobalAccounts() {
        UUID membershipId = seedPrivileges(project.id(), member);
        memberships.remove(owner, org, project.id(), member.id());
        projects.archive(owner, org, project.id());
        jdbc.update("UPDATE dialoga.app_user SET status = 'SUSPENDED' WHERE id = ?", admin.id());
        projects.restore(owner, org, project.id());
        assertPrivileges(project.id(), member, membershipId, false);
        status(404, () -> projects.get(member, org, project.id()));
        denied(member);
        status(404, () -> projects.get(admin, org, project.id()));
        denied(admin);
        assertEquals("SUSPENDED", jdbc.queryForObject("SELECT status FROM dialoga.app_user WHERE id = ?", String.class, admin.id()));
    }

    @Test void suspensionAndRoleChangeWhileArchivedCannotResurrectOldPrivileges() {
        UUID memberMembership = seedPrivileges(project.id(), member);
        UUID adminMembership = seedPrivileges(project.id(), admin);
        projects.archive(owner, org, project.id());
        // Eseguiamo le API vere mentre il progetto è archiviato: la pulizia dei
        // privilegi non filtra i progetti ACTIVE e deve raggiungere anche questo.
        team.changeStatus(owner, org, member.id(), "SUSPENDED");
        team.changeStatus(owner, org, member.id(), "ACTIVE");
        team.changeRole(owner, org, admin.id(), "MEMBER");
        projects.restore(owner, org, project.id());
        assertPrivileges(project.id(), member, memberMembership, false);
        assertPrivileges(project.id(), admin, adminMembership, false);
        for (DialogaUser target : List.of(member, admin)) {
            assertTrue(projects.list(target, org).isEmpty());
            status(404, () -> projects.get(target, org, project.id()));
            denied(target);
        }
    }

    @Test void restoreAndAccessDataParticipateInTheSameRollback() {
        UUID membershipId = seedPrivileges(project.id(), member);
        projects.archive(owner, org, project.id());
        assertThrows(IllegalStateException.class, () -> transactions.executeWithoutResult(tx -> {
            projects.restore(owner, org, project.id());
            assertEquals(project, projects.get(member, org, project.id()));
            throw new IllegalStateException("Injected rollback");
        }));
        assertEquals("ARCHIVED", projects.listArchived(owner, org).get(0).status());
        assertPrivileges(project.id(), member, membershipId, true);
        status(404, () -> projects.get(member, org, project.id()));
        denied(member);
    }

    @Test void concurrentRestoreAndArchiveLeaveOneConsistentStateWithoutChangingGrants() throws Exception {
        UUID membershipId = seedPrivileges(project.id(), member);
        projects.archive(owner, org, project.id());
        var gate = new CountDownLatch(1);
        Callable<ProjectService.Project> restore = () -> { gate.await(); return projects.restore(admin, org, project.id()); };
        Callable<Void> archive = () -> { gate.await(); projects.archive(owner, org, project.id()); return null; };
        try (var pool = Executors.newFixedThreadPool(2)) {
            var restoring = pool.submit(restore); var archiving = pool.submit(archive);
            gate.countDown();
            assertEquals(project, restoring.get(10, TimeUnit.SECONDS));
            archiving.get(10, TimeUnit.SECONDS);
        }
        assertPrivileges(project.id(), member, membershipId, true);
        // Entrambi gli ordini sono validi: dopo il commit l'elenco e la policy
        // devono descrivere lo stesso stato, senza duplicati o mezzi ripristini.
        var archived = projects.listArchived(owner, org);
        if (archived.isEmpty()) {
            assertEquals(List.of(project), projects.list(member, org));
            authorization.require(member, org, project.id(), ProjectAction.EXPORT_CONVERSATIONS);
        } else {
            assertEquals(List.of(project.id()), archived.stream().map(ProjectService.Project::id).toList());
            assertTrue(projects.list(member, org).isEmpty());
            denied(member);
        }
        tenant(org, () -> assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM dialoga.project WHERE organization_id = ?", Integer.class, org)));
    }
}
