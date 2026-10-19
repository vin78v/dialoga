package it.dialoga.security.team;

import it.dialoga.security.DialogaUser;
import it.dialoga.security.organization.OrganizationService.Organization;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
public class OrganizationTeamService {
    private final JdbcTemplate jdbc;
    private final SecureRandom random = new SecureRandom();
    public OrganizationTeamService(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    private static final String ACTIVE_MANAGER = """
            SELECT om.role FROM dialoga.organization_membership om
            JOIN dialoga.app_user u ON u.id = om.user_id
            JOIN dialoga.organization o ON o.id = om.organization_id
            WHERE om.organization_id = ? AND om.user_id = ? AND om.status = 'ACTIVE'
              AND u.status = 'ACTIVE' AND o.status = 'ACTIVE'
            """;
    private static final String INVITE_COLUMNS = """
            id, organization_id, email, organization_role,
            CASE WHEN status = 'PENDING' AND expires_at <= now() THEN 'EXPIRED' ELSE status END AS state,
            expires_at, created_at
            """;

    @Transactional(readOnly = true)
    public List<Member> members(DialogaUser actor, UUID org) {
        requireManager(actor, org, false);
        return jdbc.query("""
                SELECT m.id, m.user_id, u.email, u.first_name, u.last_name, m.role, m.status, u.status AS user_status
                FROM dialoga.organization_membership m JOIN dialoga.app_user u ON u.id = m.user_id
                WHERE m.organization_id = ? AND EXISTS (
                """ + ACTIVE_MANAGER + " AND om.role IN ('OWNER', 'ADMIN')) ORDER BY m.joined_at, m.id",
                (rs, row) -> new Member(rs.getObject("id", UUID.class), rs.getObject("user_id", UUID.class),
                        rs.getString("email"), rs.getString("first_name"), rs.getString("last_name"),
                        rs.getString("role"), rs.getString("status"), rs.getString("user_status")), org, org, actor.id());
    }

    @Transactional(readOnly = true)
    public List<Invite> invites(DialogaUser actor, UUID org) {
        requireManager(actor, org, false);
        return jdbc.query("SELECT " + INVITE_COLUMNS + " FROM dialoga.organization_invite WHERE organization_id = ? AND EXISTS ("
                + ACTIVE_MANAGER + " AND om.role IN ('OWNER', 'ADMIN')) ORDER BY created_at DESC, id", this::invite, org, org, actor.id());
    }

    @Transactional(readOnly = true)
    public Invite getInvite(DialogaUser actor, UUID org, UUID inviteId) {
        requireManager(actor, org, false);
        var rows = jdbc.query("SELECT " + INVITE_COLUMNS + " FROM dialoga.organization_invite WHERE organization_id = ? AND id = ? AND EXISTS ("
                + ACTIVE_MANAGER + " AND om.role IN ('OWNER', 'ADMIN'))", this::invite, org, inviteId, org, actor.id());
        if (rows.isEmpty()) throw error(HttpStatus.NOT_FOUND, "Invitation not found");
        return rows.get(0);
    }

    @Transactional
    public CreatedInvite create(DialogaUser actor, UUID org, String email, String role) {
        if (email == null || email.strip().length() > 254 || !email.strip().matches("[^\\s@]+@[^\\s@]+\\.[^\\s@]+")) {
            throw error(HttpStatus.BAD_REQUEST, "Invalid email address");
        }
        if (!"MEMBER".equals(role) && !"ADMIN".equals(role)) throw error(HttpStatus.BAD_REQUEST, "Invalid invitation role");
        String managerRole = requireManager(actor, org, true);
        if ("ADMIN".equals(role) && !"OWNER".equals(managerRole)) throw error(HttpStatus.FORBIDDEN, "Only an owner can invite admins");
        String normalized = email.strip().toLowerCase(Locale.ROOT);
        // Expired invitations no longer reserve the address. Never change a live invitation silently.
        jdbc.update("""
                UPDATE dialoga.organization_invite SET status = 'REVOKED'
                WHERE organization_id = ? AND lower(email) = ? AND status = 'PENDING' AND expires_at <= now()
                """, org, normalized);
        byte[] bytes = new byte[32]; random.nextBytes(bytes);
        String token = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        List<Invite> result = jdbc.query("""
                INSERT INTO dialoga.organization_invite
                  (organization_id, email, token_hash, organization_role, expires_at, invited_by_user_id)
                VALUES (?, ?, ?, ?, now() + interval '7 days', ?)
                ON CONFLICT (organization_id, lower(email)) WHERE status = 'PENDING' DO NOTHING
                RETURNING
                """ + INVITE_COLUMNS, this::invite, org, normalized, hash(token), role, actor.id());
        if (result.isEmpty()) throw error(HttpStatus.CONFLICT, "An invitation is already pending for this address");
        return new CreatedInvite(result.get(0), token);
    }

    @Transactional
    public void revoke(DialogaUser actor, UUID org, UUID inviteId) {
        requireManager(actor, org, true);
        List<String> states = jdbc.queryForList("SELECT status FROM dialoga.organization_invite WHERE organization_id = ? AND id = ? FOR UPDATE",
                String.class, org, inviteId);
        if (states.isEmpty()) throw error(HttpStatus.NOT_FOUND, "Invitation not found");
        if ("ACCEPTED".equals(states.get(0))) throw error(HttpStatus.CONFLICT, "Accepted invitations cannot be revoked");
        jdbc.update("UPDATE dialoga.organization_invite SET status = 'REVOKED' WHERE organization_id = ? AND id = ?", org, inviteId);
    }

    @Transactional
    public Organization accept(DialogaUser actor, UUID org, UUID inviteId, String token, String email, boolean verified) {
        if (token == null || !token.matches("[A-Za-z0-9_-]{43}")) throw error(HttpStatus.NOT_FOUND, "Invitation unavailable");
        lockOrganization(org);
        if (jdbc.queryForList("SELECT id FROM dialoga.app_user WHERE id = ? AND status = 'ACTIVE' FOR SHARE", UUID.class, actor.id()).isEmpty()) {
            throw error(HttpStatus.FORBIDDEN, "Account unavailable");
        }
        var rows = jdbc.query("""
                SELECT token_hash, email, organization_role, status, expires_at <= now() AS expired,
                       invited_by_user_id, accepted_by_user_id
                FROM dialoga.organization_invite WHERE organization_id = ? AND id = ? FOR UPDATE
                """, (rs, row) -> new Pending(rs.getString("token_hash"), rs.getString("email"), rs.getString("organization_role"),
                rs.getString("status"), rs.getBoolean("expired"), rs.getObject("invited_by_user_id", UUID.class),
                rs.getObject("accepted_by_user_id", UUID.class)), org, inviteId);
        if (rows.isEmpty() || !MessageDigest.isEqual(rows.get(0).hash().getBytes(StandardCharsets.US_ASCII), hash(token).getBytes(StandardCharsets.US_ASCII))) {
            throw error(HttpStatus.NOT_FOUND, "Invitation unavailable");
        }
        var invite = rows.get(0);
        if (!verified || email == null || !invite.email().equalsIgnoreCase(email.strip())) throw error(HttpStatus.FORBIDDEN, "A matching verified email is required");
        // A retry from the same identity is safe; it never restores membership or changes a role.
        if ("ACCEPTED".equals(invite.status()) && actor.id().equals(invite.acceptedBy())) return currentOrganization(actor, org);
        if (!"PENDING".equals(invite.status()) || invite.expired()) throw error(HttpStatus.GONE, "Invitation unavailable");
        List<String> issuerRoles = jdbc.queryForList(ACTIVE_MANAGER, String.class, org, invite.invitedBy());
        if (issuerRoles.isEmpty() || !("OWNER".equals(issuerRoles.get(0)) || ("ADMIN".equals(issuerRoles.get(0)) && "MEMBER".equals(invite.role())))) {
            throw error(HttpStatus.GONE, "Invitation unavailable");
        }
        if (!jdbc.queryForList("SELECT id FROM dialoga.organization_membership WHERE organization_id = ? AND user_id = ?", UUID.class, org, actor.id()).isEmpty()) {
            throw error(HttpStatus.CONFLICT, "Membership already exists");
        }
        jdbc.update("INSERT INTO dialoga.organization_membership (organization_id, user_id, role) VALUES (?, ?, ?)", org, actor.id(), invite.role());
        jdbc.update("""
                UPDATE dialoga.organization_invite SET status = 'ACCEPTED', accepted_by_user_id = ?, accepted_at = now()
                WHERE organization_id = ? AND id = ?
                """, actor.id(), org, inviteId);
        return currentOrganization(actor, org);
    }

    private Organization currentOrganization(DialogaUser actor, UUID org) {
        var rows = jdbc.query("""
                SELECT o.id, o.name, o.slug, m.role FROM dialoga.organization o
                JOIN dialoga.organization_membership m ON m.organization_id = o.id
                WHERE o.id = ? AND o.status = 'ACTIVE' AND m.user_id = ? AND m.status = 'ACTIVE'
                """, (rs, row) -> new Organization(rs.getObject("id", UUID.class), rs.getString("name"), rs.getString("slug"), rs.getString("role")), org, actor.id());
        if (rows.isEmpty()) throw error(HttpStatus.GONE, "Membership unavailable");
        return rows.get(0);
    }
    private void tenant(UUID org) { jdbc.queryForObject("SELECT set_config('app.organization_id', ?, true)", String.class, org.toString()); }
    private void lockOrganization(UUID org) {
        tenant(org);
        if (jdbc.queryForList("SELECT id FROM dialoga.organization WHERE id = ? AND status = 'ACTIVE' FOR UPDATE", UUID.class, org).isEmpty()) {
            throw error(HttpStatus.NOT_FOUND, "Organization not found");
        }
    }
    private String requireManager(DialogaUser actor, UUID org, boolean lock) {
        if (lock) lockOrganization(org); else tenant(org);
        List<String> roles = jdbc.queryForList(ACTIVE_MANAGER + (lock ? " FOR SHARE OF om, u" : ""), String.class, org, actor.id());
        if (roles.isEmpty()) throw error(HttpStatus.NOT_FOUND, "Organization not found");
        if (!Set.of("OWNER", "ADMIN").contains(roles.get(0))) throw error(HttpStatus.FORBIDDEN, "Organization owner or admin required");
        return roles.get(0);
    }
    private Invite invite(ResultSet rs, int row) throws SQLException {
        return new Invite(rs.getObject("id", UUID.class), rs.getObject("organization_id", UUID.class), rs.getString("email"),
                rs.getString("organization_role"), rs.getString("state"), rs.getTimestamp("expires_at").toInstant(), rs.getTimestamp("created_at").toInstant());
    }
    private static String hash(String token) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(token.getBytes(StandardCharsets.UTF_8))); }
        catch (NoSuchAlgorithmException e) { throw new IllegalStateException("SHA-256 unavailable", e); }
    }
    private static ResponseStatusException error(HttpStatus status, String message) { return new ResponseStatusException(status, message); }
    private record Pending(String hash, String email, String role, String status, boolean expired, UUID invitedBy, UUID acceptedBy) { }
    public record Member(UUID id, UUID userId, String email, String firstName, String lastName, String role, String status, String userStatus) { }
    public record Invite(UUID id, UUID organizationId, String email, String role, String status, Instant expiresAt, Instant createdAt) { }
    public record CreatedInvite(Invite invite, String token) { }
}
