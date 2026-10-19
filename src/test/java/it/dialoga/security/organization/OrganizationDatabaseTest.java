package it.dialoga.security.organization;

import static org.junit.jupiter.api.Assertions.*;

import it.dialoga.security.DialogaUser;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.Executors;
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

/** Run against a dedicated PostgreSQL database with V1, V3, V4, V5 and runtime grants installed. */
@EnabledIfEnvironmentVariable(named = "DIALOGA_TEST_DB_URL", matches = ".+")
class OrganizationDatabaseTest {
    private AnnotationConfigApplicationContext context;
    private JdbcTemplate jdbc;
    private OrganizationService service;
    private TransactionTemplate transactions;
    private DialogaUser owner;
    private DialogaUser outsider;
    private final List<UUID> organizations = new ArrayList<>();

    @Configuration
    @EnableTransactionManagement
    static class Config {
        @Bean DriverManagerDataSource dataSource() {
            return new DriverManagerDataSource(System.getenv("DIALOGA_TEST_DB_URL"),
                    System.getenv("DIALOGA_TEST_DB_USERNAME"), System.getenv("DIALOGA_TEST_DB_PASSWORD"));
        }
        @Bean JdbcTemplate jdbc(DriverManagerDataSource ds) { return new JdbcTemplate(ds); }
        @Bean DataSourceTransactionManager transactionManager(DriverManagerDataSource ds) {
            return new DataSourceTransactionManager(ds);
        }
        @Bean OrganizationService organizations(JdbcTemplate jdbc) { return new OrganizationService(jdbc); }
    }

    @BeforeEach void prepare() {
        context = new AnnotationConfigApplicationContext(Config.class);
        jdbc = context.getBean(JdbcTemplate.class);
        service = context.getBean(OrganizationService.class);
        transactions = new TransactionTemplate(context.getBean(DataSourceTransactionManager.class));
        owner = user();
        outsider = user();
        assertFalse(jdbc.queryForObject("SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user", Boolean.class));
        assertTrue(jdbc.queryForObject("SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = 'dialoga.organization'::regclass", Boolean.class));
    }

    private DialogaUser user() {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO dialoga.app_user (id, email) VALUES (?, ?)", id, id + "@example.test");
        return new DialogaUser(id, id + "@example.test", null, null);
    }

    private OrganizationService.Organization create(String slug) {
        var result = service.create(owner, "  My organization  ", slug);
        organizations.add(result.id());
        return result;
    }

    private void tenant(UUID id) {
        jdbc.queryForObject("SELECT set_config('app.organization_id', ?, true)", String.class, id.toString());
    }

    @AfterEach void cleanup() {
        try {
            for (UUID id : organizations) transactions.executeWithoutResult(status -> {
                tenant(id);
                jdbc.update("UPDATE dialoga.organization SET status = 'DELETED' WHERE id = ?", id);
                jdbc.update("DELETE FROM dialoga.organization_membership WHERE organization_id = ?", id);
                jdbc.update("DELETE FROM dialoga.organization WHERE id = ?", id);
            });
            jdbc.update("DELETE FROM dialoga.app_user WHERE id IN (?, ?)", owner.id(), outsider.id());
        } finally { context.close(); }
    }

    @Test void createsActiveOwnerAndReadableOrganizationAtCommit() {
        var result = create("test-" + UUID.randomUUID());
        assertEquals("My organization", result.name());
        assertEquals("OWNER", result.role());
        assertEquals(result, service.get(owner, result.id()));
        transactions.executeWithoutResult(status -> {
            tenant(result.id());
            assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM dialoga.organization_membership WHERE organization_id = ? AND user_id = ? AND role = 'OWNER' AND status = 'ACTIVE'", Integer.class, result.id(), owner.id()));
        });
    }

    @Test void duplicateSlugCannotJoinOrTakeOverAnotherOrganization() {
        var result = create("test-" + UUID.randomUUID());
        assertEquals(409, assertThrows(ResponseStatusException.class,
                () -> service.create(outsider, "Other", result.slug())).getStatusCode().value());
        assertEquals(409, assertThrows(ResponseStatusException.class,
                () -> service.create(owner, "Retry", result.slug())).getStatusCode().value());
        assertEquals(404, assertThrows(ResponseStatusException.class,
                () -> service.get(outsider, result.id())).getStatusCode().value());
        assertEquals(result, service.get(owner, result.id()));
    }

    @Test void surroundingTransactionRollsBackOrganizationAndMembershipTogether() {
        var id = new AtomicReference<UUID>();
        assertThrows(IllegalStateException.class, () -> transactions.executeWithoutResult(status -> {
            id.set(service.create(owner, "Rollback", "test-" + UUID.randomUUID()).id());
            throw new IllegalStateException("Simulated failure before commit");
        }));
        transactions.executeWithoutResult(status -> {
            tenant(id.get());
            assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM dialoga.organization WHERE id = ?", Integer.class, id.get()));
            assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM dialoga.organization_membership WHERE organization_id = ?", Integer.class, id.get()));
        });
    }

    @Test void concurrentRequestsForSameSlugProduceOneOwner() throws Exception {
        String slug = "test-" + UUID.randomUUID();
        Callable<Integer> request = () -> {
            try {
                var result = service.create(owner, "Concurrent", slug);
                synchronized (organizations) { organizations.add(result.id()); }
                return 201;
            } catch (ResponseStatusException e) { return e.getStatusCode().value(); }
        };
        try (var pool = Executors.newFixedThreadPool(2)) {
            var results = pool.invokeAll(List.of(request, request));
            assertEquals(List.of(201, 409), results.stream().map(f -> {
                try { return f.get(); } catch (Exception e) { throw new RuntimeException(e); }
            }).sorted().toList());
        }
    }

    @Test void suspendedAccountCannotCreateOrganization() {
        jdbc.update("UPDATE dialoga.app_user SET status = 'SUSPENDED' WHERE id = ?", owner.id());
        assertEquals(403, assertThrows(ResponseStatusException.class,
                () -> service.create(owner, "Forbidden", "test-" + UUID.randomUUID())).getStatusCode().value());
    }
}
