package it.dialoga.security.assistant;

import static org.junit.jupiter.api.Assertions.*;

import it.dialoga.security.DialogaUser;
import it.dialoga.security.organization.OrganizationService;
import it.dialoga.security.project.ProjectMembershipService;
import it.dialoga.security.project.ProjectService;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.context.annotation.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.transaction.annotation.EnableTransactionManagement;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.server.ResponseStatusException;

/** Prove con PostgreSQL reale, ruolo runtime e isolamento tenant obbligatorio. */
@EnabledIfEnvironmentVariable(named = "DIALOGA_TEST_DB_URL", matches = ".+")
class AssistantDatabaseTest {
    private AnnotationConfigApplicationContext context;
    private JdbcTemplate jdbc;
    private AssistantService assistants;
    private OrganizationService organizations;
    private ProjectService projects;
    private ProjectMembershipService memberships;
    private TransactionTemplate transactions;
    private DialogaUser owner, admin, member, outsider;
    private UUID org;
    private ProjectService.Project project;
    private final List<UUID> orgIds = new ArrayList<>();

    @Configuration
    @EnableTransactionManagement
    static class Config {
        @Bean DriverManagerDataSource dataSource() {
            return new DriverManagerDataSource(System.getenv("DIALOGA_TEST_DB_URL"),
                    System.getenv("DIALOGA_TEST_DB_USERNAME"), System.getenv("DIALOGA_TEST_DB_PASSWORD"));
        }
        @Bean JdbcTemplate jdbc(DriverManagerDataSource ds) { return new JdbcTemplate(ds); }
        @Bean DataSourceTransactionManager transactionManager(DriverManagerDataSource ds) { return new DataSourceTransactionManager(ds); }
        @Bean OrganizationService organizations(JdbcTemplate jdbc) { return new OrganizationService(jdbc); }
        @Bean ProjectService projects(JdbcTemplate jdbc) { return new ProjectService(jdbc); }
        @Bean ProjectMembershipService memberships(JdbcTemplate jdbc) { return new ProjectMembershipService(jdbc); }
        @Bean AssistantService assistants(JdbcTemplate jdbc) { return new AssistantService(jdbc); }
    }

    @BeforeEach void prepare() {
        context = new AnnotationConfigApplicationContext(Config.class);
        jdbc = context.getBean(JdbcTemplate.class);
        assistants = context.getBean(AssistantService.class);
        organizations = context.getBean(OrganizationService.class);
        projects = context.getBean(ProjectService.class);
        memberships = context.getBean(ProjectMembershipService.class);
        transactions = new TransactionTemplate(context.getBean(DataSourceTransactionManager.class));
        assertFalse(jdbc.queryForObject("SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user", Boolean.class));
        assertTrue(jdbc.queryForObject("SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = 'dialoga.assistant'::regclass", Boolean.class));
        owner = user(); admin = user(); member = user(); outsider = user();
        org = organization();
        tenant(org, () -> jdbc.update("""
                INSERT INTO dialoga.organization_membership (organization_id, user_id, role)
                VALUES (?, ?, 'ADMIN'), (?, ?, 'MEMBER')
                """, org, admin.id(), org, member.id()));
        project = projects.create(owner, org, "Progetto assistenti", "assistants", null);
    }

    private DialogaUser user() {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO dialoga.app_user (id, email) VALUES (?, ?)", id, id + "@example.test");
        return new DialogaUser(id, id + "@example.test", null, null);
    }
    private UUID organization() {
        UUID id = organizations.create(owner, "Assistenti di prova", "assistants-" + UUID.randomUUID()).id();
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
    private AssistantService.Details create() {
        return assistants.create(owner, org, project.id(), "Assistente", "Rispondi in italiano.", "Benvenuto!");
    }
    private void inaccessible(DialogaUser actor, UUID id) {
        status(404, () -> assistants.list(actor, org, project.id()));
        status(404, () -> assistants.get(actor, org, project.id(), id));
        status(404, () -> assistants.create(actor, org, project.id(), "Negato", "Istruzioni", null));
        status(404, () -> assistants.update(actor, org, project.id(), id, "Negato", "Istruzioni", null, 0L));
    }

    @AfterEach void cleanup() {
        try {
            for (UUID id : orgIds) tenant(id, () -> {
                // I dati appartengono soltanto agli UUID di questa prova. Prima
                // sciogliamo il riferimento circolare alla versione pubblicata.
                jdbc.update("UPDATE dialoga.assistant SET published_version_id = NULL, status = 'DRAFT' WHERE organization_id = ?", id);
                jdbc.update("DELETE FROM dialoga.assistant_version_source WHERE organization_id = ?", id);
                jdbc.update("DELETE FROM dialoga.assistant_version WHERE organization_id = ?", id);
                jdbc.update("DELETE FROM dialoga.assistant WHERE organization_id = ?", id);
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

    @Test void ownersAndAdminsCreateRealDraftsWithoutProjectAssignments() {
        assertTrue(assistants.list(owner, org, project.id()).items().isEmpty());
        assertTrue(assistants.list(admin, org, project.id()).canEdit());
        var first = assistants.create(owner, org, project.id(), "  Assistente clienti  ", "  Rispondi in italiano.  ", "  Benvenuto!  ");
        var second = assistants.create(admin, org, project.id(), "Altro assistente", "Istruzioni", "   ");
        assertEquals("Assistente clienti", first.name());
        assertEquals("Rispondi in italiano.", first.instructions());
        assertEquals("Benvenuto!", first.welcomeMessage());
        assertEquals(org, first.organizationId());
        assertEquals(project.id(), first.projectId());
        assertEquals("DRAFT", first.status());
        assertEquals(0L, first.draftLockVersion());
        assertTrue(first.canEdit());
        assertNull(second.welcomeMessage());
        assertNotEquals(first.id(), second.id());
        assertEquals(first, assistants.get(admin, org, project.id(), first.id()));
        assertEquals(Set.of(first.id(), second.id()), new HashSet<>(assistants.list(owner, org, project.id()).items().stream().map(AssistantService.Summary::id).toList()));
        tenant(org, () -> {
            assertEquals(2, jdbc.queryForObject("SELECT count(DISTINCT public_id) FROM dialoga.assistant WHERE project_id = ?", Integer.class, project.id()));
            assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM dialoga.project_membership WHERE project_id = ?", Integer.class, project.id()));
            assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM dialoga.assistant_version WHERE project_id = ?", Integer.class, project.id()));
        });
    }

    @Test void projectRoleControlsEditingAndCapabilitiesWithoutPreventingReadAccess() {
        var original = create();
        for (String role : List.of("MANAGER", "EDITOR", "OPERATOR", "VIEWER")) {
            memberships.assign(owner, org, project.id(), member.id(), role);
            boolean canEdit = Set.of("MANAGER", "EDITOR").contains(role);
            assertEquals(canEdit, assistants.list(member, org, project.id()).canEdit(), role);
            var current = assistants.get(member, org, project.id(), original.id());
            assertEquals(canEdit, current.canEdit(), role);
            assertTrue(assistants.list(member, org, project.id()).items().stream().anyMatch(item -> original.id().equals(item.id())));
            if (canEdit) {
                var updated = assistants.update(member, org, project.id(), current.id(), role, "Istruzioni", null, current.draftLockVersion());
                assertEquals(role, updated.name());
                assertTrue(assistants.create(member, org, project.id(), "Creato da " + role, "Istruzioni", null).canEdit());
            } else {
                status(403, () -> assistants.create(member, org, project.id(), "Negato", "Istruzioni", null));
                status(403, () -> assistants.update(member, org, project.id(), current.id(), "Negato", "Istruzioni", null, current.draftLockVersion()));
            }
        }
    }

    @Test void outsidersAndUnassignedOrganizationMembersCannotDiscoverAssistants() {
        var draft = create();
        inaccessible(outsider, draft.id());
        inaccessible(member, draft.id());
        assertEquals(draft, assistants.get(owner, org, project.id(), draft.id()));
    }

    @Test void everyOperationKeepsTenantProjectAndAssistantScope() {
        var draft = create();
        UUID otherOrg = organization();
        var otherProject = projects.create(owner, otherOrg, "Altro tenant", "other", null);
        var sibling = projects.create(owner, org, "Progetto fratello", "sibling", null);
        var otherDraft = assistants.create(owner, otherOrg, otherProject.id(), "Altro", "Istruzioni", null);
        status(404, () -> assistants.list(owner, otherOrg, project.id()));
        status(404, () -> assistants.create(owner, otherOrg, project.id(), "Negato", "Istruzioni", null));
        status(404, () -> assistants.get(owner, otherOrg, otherProject.id(), draft.id()));
        status(404, () -> assistants.update(owner, otherOrg, otherProject.id(), draft.id(), "Negato", "Istruzioni", null, 0L));
        status(404, () -> assistants.get(owner, org, sibling.id(), draft.id()));
        status(404, () -> assistants.update(owner, org, sibling.id(), draft.id(), "Negato", "Istruzioni", null, 0L));
        status(404, () -> assistants.get(owner, org, project.id(), otherDraft.id()));
        status(404, () -> assistants.get(owner, org, project.id(), UUID.randomUUID()));
        status(404, () -> assistants.update(owner, org, project.id(), UUID.randomUUID(), "Negato", "Istruzioni", null, 0L));
        assertTrue(assistants.list(owner, org, sibling.id()).items().isEmpty());
        assertEquals(draft, assistants.get(owner, org, project.id(), draft.id()));
    }

    @Test void inactiveAccountsMembershipsOrganizationsAndArchivedProjectsAreInaccessible() {
        var draft = create();
        memberships.assign(owner, org, project.id(), member.id(), "EDITOR");
        jdbc.update("UPDATE dialoga.app_user SET status = 'SUSPENDED' WHERE id = ?", member.id());
        inaccessible(member, draft.id());
        jdbc.update("UPDATE dialoga.app_user SET status = 'ACTIVE' WHERE id = ?", member.id());
        tenant(org, () -> jdbc.update("UPDATE dialoga.organization_membership SET status = 'SUSPENDED' WHERE organization_id = ? AND user_id = ?", org, member.id()));
        inaccessible(member, draft.id());
        tenant(org, () -> {
            jdbc.update("UPDATE dialoga.organization_membership SET status = 'ACTIVE' WHERE organization_id = ? AND user_id = ?", org, member.id());
            jdbc.update("UPDATE dialoga.project_membership SET status = 'SUSPENDED' WHERE project_id = ? AND user_id = ?", project.id(), member.id());
        });
        inaccessible(member, draft.id());
        tenant(org, () -> jdbc.update("UPDATE dialoga.organization SET status = 'SUSPENDED' WHERE id = ?", org));
        inaccessible(owner, draft.id());
        tenant(org, () -> jdbc.update("UPDATE dialoga.organization SET status = 'ACTIVE' WHERE id = ?", org));
        projects.archive(owner, org, project.id());
        inaccessible(owner, draft.id());
        projects.restore(owner, org, project.id());
        assertEquals(draft, assistants.get(owner, org, project.id(), draft.id()));
    }

    @Test void publishPermissionDoesNotGrantConfigurationEditingToViewer() {
        var draft = create();
        memberships.assign(owner, org, project.id(), member.id(), "VIEWER");
        tenant(org, () -> jdbc.update("""
                INSERT INTO dialoga.project_permission (organization_id, project_id, project_membership_id, permission)
                SELECT organization_id, project_id, id, 'ASSISTANT_PUBLISH'
                FROM dialoga.project_membership WHERE organization_id = ? AND project_id = ? AND user_id = ?
                """, org, project.id(), member.id()));
        assertFalse(assistants.list(member, org, project.id()).canEdit());
        assertFalse(assistants.get(member, org, project.id(), draft.id()).canEdit());
        status(403, () -> assistants.create(member, org, project.id(), "Negato", "Istruzioni", null));
        status(403, () -> assistants.update(member, org, project.id(), draft.id(), "Negato", "Istruzioni", null, 0L));
        assertEquals(draft, assistants.get(owner, org, project.id(), draft.id()));
    }

    @Test void updatingDraftIncrementsVersionAndPreservesServerIdentityAndUnmanagedConfiguration() {
        var draft = create();
        AtomicReference<UUID> publicId = new AtomicReference<>();
        tenant(org, () -> {
            publicId.set(jdbc.queryForObject("SELECT public_id FROM dialoga.assistant WHERE id = ?", UUID.class, draft.id()));
            jdbc.update("UPDATE dialoga.assistant SET draft_config = draft_config || '{\"futureOption\":{\"enabled\":true}}'::jsonb WHERE id = ?", draft.id());
        });
        var updated = assistants.update(admin, org, project.id(), draft.id(), "  Nuovo nome  ", "  Nuove istruzioni  ", "  ", 0L);
        assertEquals(draft.id(), updated.id());
        assertEquals("Nuovo nome", updated.name());
        assertEquals("Nuove istruzioni", updated.instructions());
        assertNull(updated.welcomeMessage());
        assertEquals(1L, updated.draftLockVersion());
        assertEquals("DRAFT", updated.status());
        assertEquals(updated, assistants.get(owner, org, project.id(), draft.id()));
        tenant(org, () -> {
            assertEquals(publicId.get(), jdbc.queryForObject("SELECT public_id FROM dialoga.assistant WHERE id = ?", UUID.class, draft.id()));
            assertEquals("true", jdbc.queryForObject("SELECT draft_config->'futureOption'->>'enabled' FROM dialoga.assistant WHERE id = ?", String.class, draft.id()));
            assertNull(jdbc.queryForObject("SELECT published_version_id FROM dialoga.assistant WHERE id = ?", UUID.class, draft.id()));
        });
    }

    @Test void staleAndUnexpectedVersionsCannotOverwriteSavedChanges() {
        var draft = create();
        status(409, () -> assistants.update(owner, org, project.id(), draft.id(), "Prematuro", "Istruzioni", null, 1L));
        var saved = assistants.update(owner, org, project.id(), draft.id(), "Salvato", "Istruzioni salvate", "Ciao", 0L);
        // Un retry dopo una risposta persa non deve sovrascrivere la versione
        // corrente: il client deve rileggere e confrontare i propri contenuti.
        status(409, () -> assistants.update(owner, org, project.id(), draft.id(), "Vecchio tab", "Vecchie istruzioni", null, 0L));
        assertEquals(saved, assistants.get(owner, org, project.id(), draft.id()));
        assertEquals(1L, saved.draftLockVersion());
    }

    @Test void publishedAndSuspendedAssistantsRemainReadableButCannotBeEditedAsDrafts() {
        var published = create();
        var suspended = create();
        tenant(org, () -> {
            UUID version = jdbc.queryForObject("""
                    INSERT INTO dialoga.assistant_version (organization_id, project_id, assistant_id, version_no, config_snapshot, published_by_user_id)
                    VALUES (?, ?, ?, 1, '{}'::jsonb, ?) RETURNING id
                    """, UUID.class, org, project.id(), published.id(), owner.id());
            jdbc.update("UPDATE dialoga.assistant SET status = 'PUBLISHED', published_version_id = ? WHERE id = ?", version, published.id());
            jdbc.update("UPDATE dialoga.assistant SET status = 'SUSPENDED' WHERE id = ?", suspended.id());
        });
        assertEquals(2, assistants.list(owner, org, project.id()).items().size());
        for (var id : List.of(published.id(), suspended.id())) {
            var current = assistants.get(owner, org, project.id(), id);
            assertTrue(Set.of("PUBLISHED", "SUSPENDED").contains(current.status()));
            assertFalse(current.canEdit());
            status(409, () -> assistants.update(owner, org, project.id(), id, "Negato", "Istruzioni", null, 0L));
            assertEquals(current, assistants.get(owner, org, project.id(), id));
        }
    }

    @Test void creationAndVersionedUpdateParticipateInTransactionRollback() {
        var original = create();
        AtomicReference<UUID> rolledBack = new AtomicReference<>();
        assertThrows(IllegalStateException.class, () -> transactions.executeWithoutResult(tx -> {
            rolledBack.set(assistants.create(owner, org, project.id(), "Non confermato", "Istruzioni", null).id());
            assistants.update(owner, org, project.id(), original.id(), "Non confermato", "Nuove istruzioni", null, 0L);
            throw new IllegalStateException("Rollback intenzionale");
        }));
        assertEquals(original, assistants.get(owner, org, project.id(), original.id()));
        assertEquals(List.of(original.id()), assistants.list(owner, org, project.id()).items().stream().map(AssistantService.Summary::id).toList());
        status(404, () -> assistants.get(owner, org, project.id(), rolledBack.get()));
    }

    @Test void concurrentUpdatesWithSameVersionHaveOneWinnerAndOneConflict() throws Exception {
        var draft = create();
        var gate = new CountDownLatch(1);
        Callable<Integer> update = () -> {
            gate.await();
            try {
                assistants.update(owner, org, project.id(), draft.id(), Thread.currentThread().getName(), "Istruzioni concorrenti", null, 0L);
                return 200;
            } catch (ResponseStatusException e) { return e.getStatusCode().value(); }
        };
        try (var pool = Executors.newFixedThreadPool(2)) {
            var first = pool.submit(update); var second = pool.submit(update); gate.countDown();
            assertEquals(List.of(200, 409), List.of(first.get(10, TimeUnit.SECONDS), second.get(10, TimeUnit.SECONDS)).stream().sorted().toList());
        }
        assertEquals(1L, assistants.get(owner, org, project.id(), draft.id()).draftLockVersion());
        assertEquals(1, assistants.list(owner, org, project.id()).items().size());
    }

    @Test void revocationAndLowerRoleAssignmentRemovePreviouslyAvailableEditing() {
        var draft = create();
        memberships.assign(owner, org, project.id(), member.id(), "EDITOR");
        assertTrue(assistants.get(member, org, project.id(), draft.id()).canEdit());
        memberships.remove(owner, org, project.id(), member.id());
        inaccessible(member, draft.id());
        memberships.assign(owner, org, project.id(), member.id(), "VIEWER");
        assertFalse(assistants.list(member, org, project.id()).canEdit());
        assertFalse(assistants.get(member, org, project.id(), draft.id()).canEdit());
        status(403, () -> assistants.update(member, org, project.id(), draft.id(), "Negato", "Istruzioni", null, 0L));
        assertEquals(draft, assistants.get(owner, org, project.id(), draft.id()));
    }
}
