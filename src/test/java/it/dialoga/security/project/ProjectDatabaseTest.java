package it.dialoga.security.project;

import static org.junit.jupiter.api.Assertions.*;
import it.dialoga.security.DialogaUser;
import it.dialoga.security.organization.OrganizationService;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.context.annotation.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.*;
import org.springframework.transaction.annotation.EnableTransactionManagement;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.server.ResponseStatusException;

@EnabledIfEnvironmentVariable(named = "DIALOGA_TEST_DB_URL", matches = ".+")
class ProjectDatabaseTest {
    private AnnotationConfigApplicationContext context;
    private JdbcTemplate jdbc;
    private ProjectService projects;
    private OrganizationService organizations;
    private TransactionTemplate transactions;
    private DialogaUser owner, member, outsider;
    private UUID org;
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
    }

    @BeforeEach void prepare() {
        context = new AnnotationConfigApplicationContext(Config.class);
        jdbc = context.getBean(JdbcTemplate.class);
        projects = context.getBean(ProjectService.class);
        organizations = context.getBean(OrganizationService.class);
        transactions = new TransactionTemplate(context.getBean(DataSourceTransactionManager.class));
        assertFalse(jdbc.queryForObject("SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user", Boolean.class));
        assertTrue(jdbc.queryForObject("SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = 'dialoga.project'::regclass", Boolean.class));
        owner = user(); member = user(); outsider = user();
        org = organization();
        inTenant(org, () -> jdbc.update("INSERT INTO dialoga.organization_membership (organization_id, user_id, role) VALUES (?, ?, 'MEMBER')", org, member.id()));
    }

    private DialogaUser user() {
        var id = UUID.randomUUID();
        jdbc.update("INSERT INTO dialoga.app_user (id, email) VALUES (?, ?)", id, id + "@example.test");
        return new DialogaUser(id, id + "@example.test", null, null);
    }
    private UUID organization() {
        UUID id = organizations.create(owner, "Test organization", "test-" + UUID.randomUUID()).id();
        orgIds.add(id); return id;
    }
    private void inTenant(UUID id, Runnable action) {
        transactions.executeWithoutResult(status -> {
            jdbc.queryForObject("SELECT set_config('app.organization_id', ?, true)", String.class, id.toString());
            action.run();
        });
    }
    private void status(int expected, Runnable action) {
        assertEquals(expected, assertThrows(ResponseStatusException.class, action::run).getStatusCode().value());
    }
    private ProjectService.Project create(String slug) { return projects.create(owner, org, "  Project name  ", slug, "  Description  "); }

    @AfterEach void cleanup() {
        try {
            for (UUID id : orgIds) inTenant(id, () -> {
                jdbc.update("UPDATE dialoga.organization SET status = 'DELETED' WHERE id = ?", id);
                jdbc.update("DELETE FROM dialoga.project_membership WHERE organization_id = ?", id);
                jdbc.update("DELETE FROM dialoga.project WHERE organization_id = ?", id);
                jdbc.update("DELETE FROM dialoga.organization_membership WHERE organization_id = ?", id);
                jdbc.update("DELETE FROM dialoga.organization WHERE id = ?", id);
            });
            jdbc.update("DELETE FROM dialoga.app_user WHERE id IN (?, ?, ?)", owner.id(), member.id(), outsider.id());
        } finally { context.close(); }
    }

    @Test void ownerCreatesListsAndReadsWithoutProjectMembership() {
        assertTrue(projects.list(owner, org).isEmpty());
        var project = create("first");
        assertEquals("Project name", project.name());
        assertEquals("Description", project.description());
        assertEquals("ACTIVE", project.status());
        assertEquals(org, project.organizationId());
        assertEquals(List.of(project), projects.list(owner, org));
        assertEquals(project, projects.get(owner, org, project.id()));
        inTenant(org, () -> assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM dialoga.project_membership WHERE project_id = ?", Integer.class, project.id())));
    }
    @Test void adminCanCreateButRegularMemberCannot() {
        status(403, () -> projects.create(member, org, "Denied", "denied", null));
        inTenant(org, () -> jdbc.update("UPDATE dialoga.organization_membership SET role = 'ADMIN' WHERE organization_id = ? AND user_id = ?", org, member.id()));
        var project = projects.create(member, org, "Admin project", "admin-project", "   ");
        assertNull(project.description());
        assertEquals(project, projects.get(member, org, project.id()));
    }
    @Test void memberOnlySeesActiveAssignedProjects() {
        var assigned = create("assigned");
        var hidden = create("hidden");
        assertTrue(projects.list(member, org).isEmpty());
        status(404, () -> projects.get(member, org, assigned.id()));
        inTenant(org, () -> jdbc.update("INSERT INTO dialoga.project_membership (organization_id, project_id, user_id, role) VALUES (?, ?, ?, 'VIEWER')", org, assigned.id(), member.id()));
        assertEquals(List.of(assigned), projects.list(member, org));
        assertEquals(assigned, projects.get(member, org, assigned.id()));
        status(404, () -> projects.get(member, org, hidden.id()));
        inTenant(org, () -> jdbc.update("UPDATE dialoga.project_membership SET status = 'SUSPENDED' WHERE project_id = ? AND user_id = ?", assigned.id(), member.id()));
        assertTrue(projects.list(member, org).isEmpty());
        status(404, () -> projects.get(member, org, assigned.id()));
    }
    @Test void outsiderCannotReadListOrCreate() {
        var project = create("private");
        status(404, () -> projects.list(outsider, org));
        status(404, () -> projects.get(outsider, org, project.id()));
        status(404, () -> projects.create(outsider, org, "Denied", "denied", null));
    }
    @Test void projectIdsCannotCrossOrganizationBoundaries() {
        var project = create("scoped");
        var otherOrg = organization();
        assertTrue(projects.list(owner, otherOrg).isEmpty());
        status(404, () -> projects.get(owner, otherOrg, project.id()));
        assertEquals(project, projects.get(owner, org, project.id()));
    }
    @Test void slugIsUniqueWithinOrganizationOnly() {
        var first = create("shared-slug");
        status(409, () -> create("shared-slug"));
        var other = projects.create(owner, organization(), "Other", "shared-slug", null);
        assertNotEquals(first.id(), other.id());
        assertEquals(List.of(first), projects.list(owner, org));
    }
    @Test void inactiveOrganizationOrMembershipOrUserCannotAccessProjects() {
        var project = create("active");
        inTenant(org, () -> jdbc.update("UPDATE dialoga.organization SET status = 'SUSPENDED' WHERE id = ?", org));
        status(404, () -> projects.list(owner, org));
        status(404, () -> projects.create(owner, org, "Denied", "denied", null));
        inTenant(org, () -> jdbc.update("UPDATE dialoga.organization SET status = 'ACTIVE' WHERE id = ?", org));
        inTenant(org, () -> jdbc.update("UPDATE dialoga.organization_membership SET status = 'SUSPENDED' WHERE organization_id = ? AND user_id = ?", org, member.id()));
        status(404, () -> projects.get(member, org, project.id()));
        jdbc.update("UPDATE dialoga.app_user SET status = 'SUSPENDED' WHERE id = ?", owner.id());
        status(404, () -> projects.get(owner, org, project.id()));
        status(404, () -> projects.create(owner, org, "Denied", "denied", null));
    }
    @Test void archivedProjectIsNotListedOrReadable() {
        var project = create("archived");
        inTenant(org, () -> jdbc.update("UPDATE dialoga.project SET status = 'ARCHIVED' WHERE id = ?", project.id()));
        assertTrue(projects.list(owner, org).isEmpty());
        status(404, () -> projects.get(owner, org, project.id()));
        status(409, () -> create("archived"));
    }
    @Test void creationParticipatesInTransactionRollback() {
        var id = new AtomicReference<UUID>();
        assertThrows(IllegalStateException.class, () -> transactions.executeWithoutResult(status -> {
            id.set(create("rollback").id()); throw new IllegalStateException("Injected failure");
        }));
        assertTrue(projects.list(owner, org).isEmpty());
        status(404, () -> projects.get(owner, org, id.get()));
    }
    @Test void concurrentSlugCollisionCreatesOneProject() throws Exception {
        Callable<Integer> create = () -> {
            try { create("concurrent"); return 201; }
            catch (ResponseStatusException e) { return e.getStatusCode().value(); }
        };
        try (var pool = Executors.newFixedThreadPool(2)) {
            var futures = pool.invokeAll(List.of(create, create));
            assertEquals(List.of(201, 409), futures.stream().map(f -> {
                try { return f.get(); } catch (Exception e) { throw new RuntimeException(e); }
            }).sorted().toList());
        }
        assertEquals(1, projects.list(owner, org).size());
    }
}
