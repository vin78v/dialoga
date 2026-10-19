package it.dialoga.security.organization;

import it.dialoga.security.DialogaUser;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
public class OrganizationService {
    private final JdbcTemplate jdbc;

    public OrganizationService(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    @Transactional
    public Organization create(DialogaUser actor, String name, String slug) {
        if (name == null || name.isBlank() || name.strip().length() > 160) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Name must contain 1 to 160 characters");
        }
        if (slug == null || slug.length() > 63 || !slug.matches("[a-z0-9]+(?:-[a-z0-9]+)*")) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid organization slug");
        }
        // Keep account status stable until the owner membership has been committed.
        if (jdbc.queryForList("SELECT id FROM dialoga.app_user WHERE id = ? AND status = 'ACTIVE' FOR SHARE",
                UUID.class, actor.id()).isEmpty()) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Account unavailable");
        }
        UUID id = UUID.randomUUID();
        setTenant(id);
        List<UUID> created = jdbc.queryForList("""
                INSERT INTO dialoga.organization (id, name, slug) VALUES (?, ?, ?)
                ON CONFLICT (slug) DO NOTHING RETURNING id
                """, UUID.class, id, name.strip(), slug);
        if (created.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Organization slug unavailable");
        }
        jdbc.update("""
                INSERT INTO dialoga.organization_membership (organization_id, user_id, role, status)
                VALUES (?, ?, 'OWNER', 'ACTIVE')
                """, id, actor.id());
        return new Organization(id, name.strip(), slug, "OWNER");
    }

    @Transactional(readOnly = true)
    public Organization get(DialogaUser actor, UUID id) {
        setTenant(id);
        List<Organization> rows = jdbc.query("""
                SELECT o.id, o.name, o.slug, m.role
                FROM dialoga.organization o
                JOIN dialoga.organization_membership m ON m.organization_id = o.id
                JOIN dialoga.app_user u ON u.id = m.user_id
                WHERE o.id = ? AND o.status = 'ACTIVE'
                  AND m.user_id = ? AND m.status = 'ACTIVE' AND u.status = 'ACTIVE'
                """, (rs, row) -> new Organization(rs.getObject("id", UUID.class),
                rs.getString("name"), rs.getString("slug"), rs.getString("role")), id, actor.id());
        if (rows.isEmpty()) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Organization not found");
        return rows.get(0);
    }

    private void setTenant(UUID id) {
        jdbc.queryForObject("SELECT set_config('app.organization_id', ?, true)", String.class, id.toString());
    }

    public record Organization(UUID id, String name, String slug, String role) { }
}
