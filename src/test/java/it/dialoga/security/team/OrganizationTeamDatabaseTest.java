package it.dialoga.security.team;
import static org.junit.jupiter.api.Assertions.*;
import it.dialoga.security.DialogaUser;
import it.dialoga.security.organization.OrganizationService;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.context.annotation.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.*;
import org.springframework.transaction.annotation.EnableTransactionManagement;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.server.ResponseStatusException;

@EnabledIfEnvironmentVariable(named = "DIALOGA_TEST_DB_URL", matches = ".+")
class OrganizationTeamDatabaseTest {
    private AnnotationConfigApplicationContext context;
    private JdbcTemplate jdbc;
    private OrganizationTeamService team;
    private OrganizationService organizations;
    private TransactionTemplate transactions;
    private DialogaUser owner, admin, member, recipient, otherIdentity;
    private UUID org;
    private final List<UUID> orgIds = new ArrayList<>();
    @Configuration @EnableTransactionManagement
    static class Config {
        @Bean DriverManagerDataSource ds() { return new DriverManagerDataSource(System.getenv("DIALOGA_TEST_DB_URL"), System.getenv("DIALOGA_TEST_DB_USERNAME"), System.getenv("DIALOGA_TEST_DB_PASSWORD")); }
        @Bean JdbcTemplate jdbc(DriverManagerDataSource ds) { return new JdbcTemplate(ds); }
        @Bean DataSourceTransactionManager transactionManager(DriverManagerDataSource ds) { return new DataSourceTransactionManager(ds); }
        @Bean OrganizationService organizations(JdbcTemplate jdbc) { return new OrganizationService(jdbc); }
        @Bean OrganizationTeamService team(JdbcTemplate jdbc) { return new OrganizationTeamService(jdbc); }
    }
    @BeforeEach void prepare() {
        context = new AnnotationConfigApplicationContext(Config.class);
        jdbc = context.getBean(JdbcTemplate.class); team = context.getBean(OrganizationTeamService.class);
        organizations = context.getBean(OrganizationService.class); transactions = new TransactionTemplate(context.getBean(DataSourceTransactionManager.class));
        assertFalse(jdbc.queryForObject("SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user", Boolean.class));
        assertTrue(jdbc.queryForObject("SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = 'dialoga.organization_invite'::regclass", Boolean.class));
        owner = user(null); admin = user(null); member = user(null); recipient = user(null); otherIdentity = user(recipient.email());
        org = organization();
        tenant(org, () -> {
            jdbc.update("INSERT INTO dialoga.organization_membership (organization_id, user_id, role) VALUES (?, ?, 'ADMIN'), (?, ?, 'MEMBER')", org, admin.id(), org, member.id());
        });
    }
    private DialogaUser user(String email) {
        UUID id = UUID.randomUUID(); if (email == null) email = id + "@example.test";
        jdbc.update("INSERT INTO dialoga.app_user (id, email) VALUES (?, ?)", id, email);
        return new DialogaUser(id, email, null, null);
    }
    private UUID organization() { var id = organizations.create(owner, "Team test", "team-" + UUID.randomUUID()).id(); orgIds.add(id); return id; }
    private void tenant(UUID id, Runnable action) { transactions.executeWithoutResult(s -> { jdbc.queryForObject("SELECT set_config('app.organization_id', ?, true)", String.class, id.toString()); action.run(); }); }
    private void status(int expected, Runnable action) { assertEquals(expected, assertThrows(ResponseStatusException.class, action::run).getStatusCode().value()); }
    private OrganizationTeamService.CreatedInvite invite() { return team.create(owner, org, recipient.email(), "MEMBER"); }
    private OrganizationService.Organization accept(OrganizationTeamService.CreatedInvite invite, DialogaUser actor) { return team.accept(actor, org, invite.invite().id(), invite.token(), actor.email(), true); }
    @AfterEach void cleanup() {
        try {
            for (UUID id : orgIds) tenant(id, () -> {
                jdbc.update("DELETE FROM dialoga.organization_invite WHERE organization_id = ?", id);
                jdbc.update("UPDATE dialoga.organization SET status = 'DELETED' WHERE id = ?", id);
                jdbc.update("DELETE FROM dialoga.organization_membership WHERE organization_id = ?", id);
                jdbc.update("DELETE FROM dialoga.organization WHERE id = ?", id);
            });
            jdbc.update("DELETE FROM dialoga.app_user WHERE id IN (?, ?, ?, ?, ?)", owner.id(), admin.id(), member.id(), recipient.id(), otherIdentity.id());
        } finally { context.close(); }
    }
    @Test void invitationStoresOnlyHashAndListsOnlyMetadata() {
        var created = invite(); assertEquals(43, created.token().length()); assertEquals("PENDING", created.invite().status());
        assertTrue(created.invite().expiresAt().isAfter(created.invite().createdAt().plusSeconds(6 * 86400)));
        tenant(org, () -> {
            String hash = jdbc.queryForObject("SELECT token_hash FROM dialoga.organization_invite WHERE id = ?", String.class, created.invite().id());
            assertEquals(64, hash.length()); assertNotEquals(created.token(), hash);
        });
        assertEquals(List.of(created.invite()), team.invites(owner, org));
        assertEquals(created.invite(), team.getInvite(owner, org, created.invite().id()));
        assertEquals(3, team.members(owner, org).size());
    }
    @Test void verifiedCurrentEmailIsRequiredAndUnverifiedOrWrongEmailDoesNotConsumeToken() {
        var invite = invite();
        status(403, () -> team.accept(recipient, org, invite.invite().id(), invite.token(), recipient.email(), false));
        status(403, () -> team.accept(recipient, org, invite.invite().id(), invite.token(), "other@example.test", true));
        assertEquals("PENDING", team.invites(owner, org).get(0).status());
        var staleProfile = new DialogaUser(recipient.id(), "stale@example.test", null, null);
        var result = team.accept(staleProfile, org, invite.invite().id(), invite.token(), recipient.email().toUpperCase(Locale.ROOT), true);
        assertEquals("MEMBER", result.role()); assertEquals(org, result.id());
        assertTrue(team.members(owner, org).stream().anyMatch(m -> m.userId().equals(recipient.id()) && m.role().equals("MEMBER")));
    }
    @Test void onlyOwnerCanInviteAdminAndAdminCanInviteMember() {
        status(403, () -> team.create(admin, org, recipient.email(), "ADMIN"));
        var invite = team.create(owner, org, recipient.email(), "ADMIN");
        assertEquals("ADMIN", accept(invite, recipient).role());
        assertEquals("MEMBER", team.create(admin, org, "next@example.test", "MEMBER").invite().role());
    }
    @Test void membersAndOutsidersCannotManageTeam() {
        status(403, () -> team.members(member, org)); status(403, () -> team.invites(member, org));
        status(403, () -> team.create(member, org, recipient.email(), "MEMBER"));
        status(404, () -> team.members(recipient, org)); status(404, () -> team.create(recipient, org, recipient.email(), "MEMBER"));
        var invite = invite(); status(403, () -> team.revoke(member, org, invite.invite().id()));
        var otherOrg = organization(); status(404, () -> team.revoke(owner, otherOrg, invite.invite().id()));
        status(404, () -> team.getInvite(owner, otherOrg, invite.invite().id()));
        status(403, () -> team.getInvite(member, org, invite.invite().id()));
        status(404, () -> team.accept(recipient, otherOrg, invite.invite().id(), invite.token(), recipient.email(), true));
    }
    @Test void pendingAddressIsUniqueCaseInsensitively() {
        var first = invite(); status(409, () -> team.create(owner, org, "  " + recipient.email().toUpperCase(Locale.ROOT) + "  ", "ADMIN"));
        assertEquals(List.of(first.invite()), team.invites(owner, org));
    }
    @Test void revokedInvitationCannotBeAcceptedAndRevocationIsIdempotent() {
        var invite = invite(); team.revoke(owner, org, invite.invite().id()); team.revoke(owner, org, invite.invite().id());
        assertEquals("REVOKED", team.invites(owner, org).get(0).status());
        status(410, () -> accept(invite, recipient)); assertEquals(3, team.members(owner, org).size());
    }
    @Test void expiredInvitationCanBeReplacedWithoutWeakeningExpiry() {
        var old = invite(); tenant(org, () -> jdbc.update("UPDATE dialoga.organization_invite SET created_at = now() - interval '2 days', expires_at = now() - interval '1 day' WHERE id = ?", old.invite().id()));
        assertEquals("EXPIRED", team.invites(owner, org).get(0).status()); status(410, () -> accept(old, recipient));
        var next = invite(); assertNotEquals(old.token(), next.token());
        assertTrue(team.invites(owner, org).stream().anyMatch(i -> i.id().equals(old.invite().id()) && i.status().equals("REVOKED")));
        assertEquals("MEMBER", accept(next, recipient).role());
    }
    @Test void existingMembershipIsNeverPromotedOrReactivatedByInvitation() {
        var invite = team.create(owner, org, member.email(), "ADMIN");
        status(409, () -> accept(invite, member));
        tenant(org, () -> jdbc.update("UPDATE dialoga.organization_membership SET status = 'SUSPENDED' WHERE organization_id = ? AND user_id = ?", org, member.id()));
        status(409, () -> accept(invite, member));
        assertTrue(team.members(owner, org).stream().anyMatch(m -> m.userId().equals(member.id()) && m.role().equals("MEMBER") && m.status().equals("SUSPENDED")));
    }
    @Test void acceptanceRetryIsIdempotentButDoesNotRestorePermissions() {
        var invite = team.create(owner, org, recipient.email(), "ADMIN");
        assertEquals(accept(invite, recipient), accept(invite, recipient));
        assertEquals(4, team.members(owner, org).size());
        tenant(org, () -> jdbc.update("UPDATE dialoga.organization_membership SET role = 'MEMBER' WHERE organization_id = ? AND user_id = ?", org, recipient.id()));
        assertEquals("MEMBER", accept(invite, recipient).role());
        tenant(org, () -> jdbc.update("UPDATE dialoga.organization_membership SET status = 'SUSPENDED' WHERE organization_id = ? AND user_id = ?", org, recipient.id()));
        status(410, () -> accept(invite, recipient));
        status(409, () -> team.revoke(owner, org, invite.invite().id()));
    }
    @Test void wrongTokenCannotRevealOrConsumeInvitation() {
        var invite = invite(); String wrong = invite.token().charAt(0) == 'A' ? "B" + invite.token().substring(1) : "A" + invite.token().substring(1);
        status(404, () -> team.accept(recipient, org, invite.invite().id(), wrong, recipient.email(), true));
        status(404, () -> team.accept(recipient, org, UUID.randomUUID(), invite.token(), recipient.email(), true));
        assertEquals("PENDING", team.invites(owner, org).get(0).status());
    }
    @Test void inviterMustStillBeAuthorizedAtAcceptance() {
        var invite = team.create(admin, org, recipient.email(), "MEMBER");
        tenant(org, () -> jdbc.update("UPDATE dialoga.organization_membership SET role = 'MEMBER' WHERE organization_id = ? AND user_id = ?", org, admin.id()));
        status(410, () -> accept(invite, recipient));
    }
    @Test void onlyOneIdentityCanConsumeTokenEvenWithSameEmail() throws Exception {
        var invite = invite();
        try (var pool = Executors.newFixedThreadPool(2)) {
            List<Callable<Integer>> tasks = List.of(() -> code(invite, recipient), () -> code(invite, otherIdentity));
            var results = pool.invokeAll(tasks).stream().map(f -> { try { return f.get(); } catch (Exception e) { throw new RuntimeException(e); } }).sorted().toList();
            assertEquals(List.of(201, 410), results);
        }
        assertEquals(4, team.members(owner, org).size());
    }
    private int code(OrganizationTeamService.CreatedInvite invite, DialogaUser actor) {
        try { accept(invite, actor); return 201; } catch (ResponseStatusException e) { return e.getStatusCode().value(); }
    }
    @Test void rollbackRestoresInvitationAndMembershipTogether() {
        var invite = invite();
        assertThrows(IllegalStateException.class, () -> transactions.executeWithoutResult(s -> { accept(invite, recipient); throw new IllegalStateException("Injected failure"); }));
        assertEquals("PENDING", team.invites(owner, org).get(0).status()); assertEquals(3, team.members(owner, org).size());
        assertEquals("MEMBER", accept(invite, recipient).role());
    }
    @Test void suspendedOrganizationOrRecipientBlocksAcceptance() {
        var invite = invite(); jdbc.update("UPDATE dialoga.app_user SET status = 'SUSPENDED' WHERE id = ?", recipient.id());
        status(403, () -> accept(invite, recipient)); jdbc.update("UPDATE dialoga.app_user SET status = 'ACTIVE' WHERE id = ?", recipient.id());
        tenant(org, () -> jdbc.update("UPDATE dialoga.organization SET status = 'SUSPENDED' WHERE id = ?", org));
        status(404, () -> accept(invite, recipient)); status(404, () -> team.invites(owner, org));
    }
    @Test void concurrentInvitationsForOneAddressCreateOnePendingRecord() throws Exception {
        Callable<Integer> create = () -> { try { invite(); return 201; } catch (ResponseStatusException e) { return e.getStatusCode().value(); } };
        try (var pool = Executors.newFixedThreadPool(2)) {
            var codes = pool.invokeAll(List.of(create, create)).stream().map(f -> { try { return f.get(); } catch (Exception e) { throw new RuntimeException(e); } }).sorted().toList();
            assertEquals(List.of(201, 409), codes);
        }
        assertEquals(1, team.invites(owner, org).size());
    }
    @Test void revokeAndAcceptSerializeWithoutPartialMembership() throws Exception {
        var invite = invite();
        Callable<Integer> accept = () -> code(invite, recipient);
        Callable<Integer> revoke = () -> { try { team.revoke(owner, org, invite.invite().id()); return 204; } catch (ResponseStatusException e) { return e.getStatusCode().value(); } };
        try (var pool = Executors.newFixedThreadPool(2)) {
            var futures = pool.invokeAll(List.of(accept, revoke));
            var codes = List.of(futures.get(0).get(), futures.get(1).get());
            if (codes.equals(List.of(201, 409))) {
                assertEquals("ACCEPTED", team.getInvite(owner, org, invite.invite().id()).status());
                assertEquals(4, team.members(owner, org).size());
            } else {
                assertEquals(List.of(410, 204), codes);
                assertEquals("REVOKED", team.getInvite(owner, org, invite.invite().id()).status());
                assertEquals(3, team.members(owner, org).size());
            }
        }
    }

}
