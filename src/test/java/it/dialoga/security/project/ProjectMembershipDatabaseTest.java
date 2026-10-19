package it.dialoga.security.project;

import static org.junit.jupiter.api.Assertions.*;
import it.dialoga.security.DialogaUser;
import it.dialoga.security.authorization.*;
import it.dialoga.security.organization.OrganizationService;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.context.annotation.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.server.ResponseStatusException;

/** Prove con ruolo runtime reale e RLS forzata: nessun superuser per le operazioni applicative. */
@EnabledIfEnvironmentVariable(named = "DIALOGA_TEST_DB_URL", matches = ".+")
class ProjectMembershipDatabaseTest {
    private AnnotationConfigApplicationContext context;
    private JdbcTemplate jdbc;
    private ProjectMembershipService memberships;
    private ProjectService projects;
    private OrganizationService organizations;
    private ProjectAuthorizationService authorization;
    private TransactionTemplate transactions;
    private DialogaUser owner, admin, member, outsider;
    private UUID org, project;
    private final List<UUID> orgIds = new ArrayList<>();
    @Configuration
    static class Config {
        @Bean ProjectMembershipService memberships(JdbcTemplate jdbc) { return new ProjectMembershipService(jdbc); }
        @Bean ProjectAuthorizationService authorization(JdbcTemplate jdbc) { return new ProjectAuthorizationService(jdbc); }
    }
    @BeforeEach void prepare() {
        // Stessa configurazione JDBC delle prove dei progetti: evita un database di
        // test privilegiato che nasconderebbe errori nelle policy RLS o nei grant.
        context = new AnnotationConfigApplicationContext(ProjectDatabaseTest.Config.class, Config.class);
        jdbc = context.getBean(JdbcTemplate.class); memberships = context.getBean(ProjectMembershipService.class);
        projects = context.getBean(ProjectService.class); organizations = context.getBean(OrganizationService.class);
        authorization = context.getBean(ProjectAuthorizationService.class);
        transactions = new TransactionTemplate(context.getBean(DataSourceTransactionManager.class));
        assertFalse(jdbc.queryForObject("SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user", Boolean.class));
        assertTrue(jdbc.queryForObject("SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = 'dialoga.project_membership'::regclass", Boolean.class));
        owner = user(); admin = user(); member = user(); outsider = user();
        org = organization();
        tenant(org, () -> jdbc.update("INSERT INTO dialoga.organization_membership (organization_id, user_id, role) VALUES (?, ?, 'ADMIN'), (?, ?, 'MEMBER')", org, admin.id(), org, member.id()));
        project = projects.create(owner, org, "Project", "project", null).id();
    }
    private DialogaUser user() {
        UUID id = UUID.randomUUID(); jdbc.update("INSERT INTO dialoga.app_user (id, email) VALUES (?, ?)", id, id + "@example.test");
        return new DialogaUser(id, id + "@example.test", null, null);
    }
    private UUID organization() { UUID id = organizations.create(owner, "Assignment test", "assignment-" + UUID.randomUUID()).id(); orgIds.add(id); return id; }
    private void tenant(UUID id, Runnable action) { transactions.executeWithoutResult(s -> { jdbc.queryForObject("SELECT set_config('app.organization_id', ?, true)", String.class, id.toString()); action.run(); }); }
    private void status(int expected, Runnable action) { assertEquals(expected, assertThrows(ResponseStatusException.class, action::run).getStatusCode().value()); }
    private ProjectMembershipService.Membership assign(String role) { return memberships.assign(owner, org, project, member.id(), role); }
    private void grants(UUID project, UUID membership) {
        tenant(org, () -> {
            jdbc.update("INSERT INTO dialoga.project_permission (organization_id, project_id, project_membership_id, permission) VALUES (?, ?, ?, 'CONVERSATION_READ')", org, project, membership);
            jdbc.update("INSERT INTO dialoga.project_user_permission (organization_id, project_id, user_id, permission, granted_by_user_id) VALUES (?, ?, ?, 'PERSONAL_DATA_EXPORT', ?)", org, project, member.id(), owner.id());
        });
    }
    private void grantCounts(UUID project, int count) {
        tenant(org, () -> {
            assertEquals(count, jdbc.queryForObject("SELECT count(*) FROM dialoga.project_permission WHERE organization_id = ? AND project_id = ?", Integer.class, org, project));
            assertEquals(count, jdbc.queryForObject("SELECT count(*) FROM dialoga.project_user_permission WHERE organization_id = ? AND project_id = ?", Integer.class, org, project));
        });
    }
    @AfterEach void cleanup() {
        try {
            for (UUID id : orgIds) tenant(id, () -> {
                jdbc.update("DELETE FROM dialoga.project_permission WHERE organization_id = ?", id);
                jdbc.update("DELETE FROM dialoga.project_user_permission WHERE organization_id = ?", id);
                jdbc.update("DELETE FROM dialoga.project_membership WHERE organization_id = ?", id);
                jdbc.update("DELETE FROM dialoga.project WHERE organization_id = ?", id);
                jdbc.update("UPDATE dialoga.organization SET status = 'DELETED' WHERE id = ?", id);
                jdbc.update("DELETE FROM dialoga.organization_membership WHERE organization_id = ?", id);
                jdbc.update("DELETE FROM dialoga.organization WHERE id = ?", id);
            });
            jdbc.update("DELETE FROM dialoga.app_user WHERE id IN (?, ?, ?, ?)", owner.id(), admin.id(), member.id(), outsider.id());
        } finally { context.close(); }
    }
    @Test void assignmentIsIdempotentAndDoesNotElevateOrganizationRole() {
        assertTrue(projects.list(member, org).isEmpty());
        var first = assign("VIEWER"); assertEquals(first, assign("VIEWER"));
        assertEquals(1, memberships.list(owner, org, project).size());
        assertEquals(project, projects.list(member, org).get(0).id());
        assertEquals("MEMBER", organizations.get(member, org).role());
        assertEquals("ACTIVE", first.status());
    }
    @Test void projectRolesAreEnforcedByExistingAuthorizationPolicy() {
        for (String role : List.of("VIEWER", "OPERATOR", "EDITOR", "MANAGER")) {
            assign(role); authorization.require(member, org, project, ProjectAction.VIEW);
            if (Set.of("EDITOR", "MANAGER").contains(role)) authorization.require(member, org, project, ProjectAction.EDIT_CONFIGURATION);
            else assertThrows(AccessDeniedException.class, () -> authorization.require(member, org, project, ProjectAction.EDIT_CONFIGURATION));
            assertThrows(AccessDeniedException.class, () -> authorization.require(member, org, project, ProjectAction.EXPORT_CONVERSATIONS));
        }
    }
    @Test void adminCanAssignButProjectManagerCannotManageMemberships() {
        memberships.assign(admin, org, project, member.id(), "MANAGER");
        assertEquals(1, memberships.list(admin, org, project).size());
        status(403, () -> memberships.list(member, org, project));
        status(403, () -> memberships.assign(member, org, project, member.id(), "MANAGER"));
        status(403, () -> memberships.remove(member, org, project, member.id()));
        status(404, () -> memberships.list(outsider, org, project));
    }
    @Test void targetsMustBeActiveRegularOrganizationMembers() {
        status(404, () -> memberships.assign(owner, org, project, outsider.id(), "VIEWER"));
        status(409, () -> memberships.assign(owner, org, project, admin.id(), "VIEWER"));
        status(409, () -> memberships.remove(owner, org, project, owner.id()));
        assign("VIEWER");
        tenant(org, () -> jdbc.update("UPDATE dialoga.organization_membership SET status = 'SUSPENDED' WHERE organization_id = ? AND user_id = ?", org, member.id()));
        status(409, () -> assign("EDITOR"));
        memberships.remove(owner, org, project, member.id());
        tenant(org, () -> jdbc.update("UPDATE dialoga.organization_membership SET status = 'ACTIVE' WHERE organization_id = ? AND user_id = ?", org, member.id()));
        jdbc.update("UPDATE dialoga.app_user SET status = 'SUSPENDED' WHERE id = ?", member.id());
        status(409, () -> assign("EDITOR"));
        memberships.remove(owner, org, project, member.id());
    }
    @Test void crossOrganizationIdsCannotReadOrMutateAssignments() {
        var other = organization();
        status(404, () -> memberships.list(owner, other, project));
        status(404, () -> memberships.assign(owner, other, project, member.id(), "VIEWER"));
        status(404, () -> memberships.remove(owner, other, project, member.id()));
        assertTrue(memberships.list(owner, org, project).isEmpty());
    }
    @Test void inactiveActorOrganizationAndArchivedProjectAreRejected() {
        tenant(org, () -> jdbc.update("UPDATE dialoga.project SET status = 'ARCHIVED' WHERE id = ?", project));
        status(404, () -> assign("VIEWER"));
        tenant(org, () -> jdbc.update("UPDATE dialoga.project SET status = 'ACTIVE' WHERE id = ?", project));
        tenant(org, () -> jdbc.update("UPDATE dialoga.organization SET status = 'SUSPENDED' WHERE id = ?", org));
        status(404, () -> assign("VIEWER"));
        tenant(org, () -> jdbc.update("UPDATE dialoga.organization SET status = 'ACTIVE' WHERE id = ?", org));
        jdbc.update("UPDATE dialoga.app_user SET status = 'SUSPENDED' WHERE id = ?", owner.id());
        status(404, () -> memberships.list(owner, org, project));
        status(404, () -> assign("VIEWER"));
    }
    @Test void sameRoleRetryKeepsGrantsButRoleChangeClearsBothSources() {
        var membership = assign("VIEWER"); grants(project, membership.id());
        authorization.require(member, org, project, ProjectAction.EXPORT_CONVERSATIONS);
        assign("VIEWER"); grantCounts(project, 1);
        assign("EDITOR"); grantCounts(project, 0);
        assertThrows(AccessDeniedException.class, () -> authorization.require(member, org, project, ProjectAction.EXPORT_CONVERSATIONS));
    }
    @Test void revocationIsIdempotentClearsGrantsAndReactivationDoesNotRestoreThem() {
        var membership = assign("VIEWER"); grants(project, membership.id());
        memberships.remove(owner, org, project, member.id()); memberships.remove(owner, org, project, member.id());
        grantCounts(project, 0); assertTrue(projects.list(member, org).isEmpty());
        assertThrows(AccessDeniedException.class, () -> authorization.require(member, org, project, ProjectAction.VIEW));
        assertEquals(membership.id(), assign("VIEWER").id());
        grantCounts(project, 0);
        assertThrows(AccessDeniedException.class, () -> authorization.require(member, org, project, ProjectAction.EXPORT_CONVERSATIONS));
    }
    @Test void changingOneProjectLeavesSiblingAssignmentsAndGrantsUntouched() {
        var first = assign("VIEWER"); grants(project, first.id());
        UUID other = projects.create(owner, org, "Other", "other", null).id();
        var second = memberships.assign(owner, org, other, member.id(), "VIEWER"); grants(other, second.id());
        memberships.remove(owner, org, project, member.id());
        grantCounts(project, 0); grantCounts(other, 1);
        assertEquals(other, projects.list(member, org).get(0).id());
        authorization.require(member, org, other, ProjectAction.EXPORT_CONVERSATIONS);
    }
    @Test void rollbackRestoresMembershipAndExplicitGrantsTogether() {
        var before = assign("VIEWER"); grants(project, before.id());
        assertThrows(IllegalStateException.class, () -> transactions.executeWithoutResult(s -> { assign("EDITOR"); throw new IllegalStateException("Injected failure"); }));
        assertEquals(before, memberships.list(owner, org, project).get(0)); grantCounts(project, 1);
        assertThrows(IllegalStateException.class, () -> transactions.executeWithoutResult(s -> { memberships.remove(owner, org, project, member.id()); throw new IllegalStateException("Injected failure"); }));
        assertEquals(before, memberships.list(owner, org, project).get(0)); grantCounts(project, 1);
    }
    @Test void concurrentAssignmentsKeepOneMembershipIdentifier() throws Exception {
        try (var pool = Executors.newFixedThreadPool(2)) {
            var futures = pool.invokeAll(List.<Callable<ProjectMembershipService.Membership>>of(() -> assign("VIEWER"), () -> assign("EDITOR")));
            assertEquals(futures.get(0).get().id(), futures.get(1).get().id());
        }
        assertEquals(1, memberships.list(owner, org, project).size());
    }
    @Test void assignmentAndRevocationSerializeWithoutPartialPermissions() throws Exception {
        try (var pool = Executors.newFixedThreadPool(2)) {
            var results = pool.invokeAll(List.<Callable<Void>>of(() -> { assign("VIEWER"); return null; }, () -> { memberships.remove(owner, org, project, member.id()); return null; }));
            for (var result : results) result.get();
        }
        var rows = memberships.list(owner, org, project); assertEquals(1, rows.size());
        assertEquals("ACTIVE".equals(rows.get(0).status()) ? 1 : 0, projects.list(member, org).size());
        grantCounts(project, 0);
    }
}
