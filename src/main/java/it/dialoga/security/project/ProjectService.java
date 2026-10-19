package it.dialoga.security.project;

import it.dialoga.security.DialogaUser;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
public class ProjectService {
    private final JdbcTemplate jdbc;

    public ProjectService(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    private static final String VISIBLE_PROJECTS = """
            SELECT p.id, p.organization_id, p.name, p.slug, p.description, p.status
            FROM dialoga.project p
            JOIN dialoga.organization o ON o.id = p.organization_id
            JOIN dialoga.organization_membership om ON om.organization_id = o.id
            JOIN dialoga.app_user u ON u.id = om.user_id
            WHERE p.organization_id = ? AND p.status = 'ACTIVE'
              AND om.user_id = ? AND om.status = 'ACTIVE'
              AND o.status = 'ACTIVE' AND u.status = 'ACTIVE'
              AND (om.role IN ('OWNER', 'ADMIN') OR EXISTS (
                  SELECT 1 FROM dialoga.project_membership pm
                  WHERE pm.organization_id = p.organization_id AND pm.project_id = p.id
                    AND pm.user_id = om.user_id AND pm.status = 'ACTIVE'))
            """;

    @Transactional(readOnly = true)
    public List<Project> list(DialogaUser actor, UUID organizationId) {
        requireOrganization(actor, organizationId, false);
        return jdbc.query(VISIBLE_PROJECTS + " ORDER BY p.created_at DESC, p.id", this::map,
                organizationId, actor.id());
    }

    @Transactional(readOnly = true)
    public List<Project> listArchived(DialogaUser actor, UUID organizationId) {
        String role = requireOrganization(actor, organizationId, false);
        if (!"OWNER".equals(role) && !"ADMIN".equals(role)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Organization owner or admin required");
        }
        // Il controllo amministrativo viene ripetuto nella lettura finale: una
        // demozione concorrente al precontrollo non autorizza a vedere gli archivi.
        return jdbc.query("""
                SELECT p.id, p.organization_id, p.name, p.slug, p.description, p.status
                FROM dialoga.project p
                JOIN dialoga.organization o ON o.id = p.organization_id
                JOIN dialoga.organization_membership om ON om.organization_id = o.id
                JOIN dialoga.app_user u ON u.id = om.user_id
                WHERE p.organization_id = ? AND p.status = 'ARCHIVED'
                  AND om.user_id = ? AND om.role IN ('OWNER', 'ADMIN') AND om.status = 'ACTIVE'
                  AND o.status = 'ACTIVE' AND u.status = 'ACTIVE'
                ORDER BY p.updated_at DESC, p.id
                """, this::map, organizationId, actor.id());
    }

    @Transactional(readOnly = true)
    public Project get(DialogaUser actor, UUID organizationId, UUID projectId) {
        requireOrganization(actor, organizationId, false);
        List<Project> rows = jdbc.query(VISIBLE_PROJECTS + " AND p.id = ?", this::map,
                organizationId, actor.id(), projectId);
        if (rows.isEmpty()) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Project not found");
        return rows.get(0);
    }

    @Transactional
    public Project create(DialogaUser actor, UUID organizationId, String name, String slug, String description) {
        if (name == null || name.isBlank() || name.strip().length() > 160) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Name must contain 1 to 160 characters");
        }
        if (slug == null || slug.length() > 63 || !slug.matches("[a-z0-9]+(?:-[a-z0-9]+)*")) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid project slug");
        }
        if (description != null && description.length() > 2000) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Description must contain at most 2000 characters");
        }
        String role = requireOrganization(actor, organizationId, true);
        if (!"OWNER".equals(role) && !"ADMIN".equals(role)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Organization owner or admin required");
        }
        UUID id = UUID.randomUUID();
        String cleanedDescription = description == null || description.isBlank() ? null : description.strip();
        List<UUID> created = jdbc.queryForList("""
                INSERT INTO dialoga.project (id, organization_id, name, slug, description)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT (organization_id, slug) DO NOTHING RETURNING id
                """, UUID.class, id, organizationId, name.strip(), slug, cleanedDescription);
        if (created.isEmpty()) throw new ResponseStatusException(HttpStatus.CONFLICT, "Project slug unavailable");
        return new Project(id, organizationId, name.strip(), slug, cleanedDescription, "ACTIVE");
    }

    /** Lo slug rimane stabile: cambiare i metadati non modifica gli indirizzi esistenti. */
    @Transactional
    public Project update(DialogaUser actor, UUID organizationId, UUID projectId, String name, String description) {
        if (name == null || name.isBlank() || name.strip().length() > 160) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Name must contain 1 to 160 characters");
        }
        if (description != null && description.length() > 2000) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Description must contain at most 2000 characters");
        }
        requireAdministrator(actor, organizationId);
        // Il filtro ACTIVE impedisce a una modifica tardiva di riattivare un archivio.
        var rows = jdbc.query("""
                UPDATE dialoga.project SET name = ?, description = ?
                WHERE organization_id = ? AND id = ? AND status = 'ACTIVE'
                RETURNING id, organization_id, name, slug, description, status
                """, this::map, name.strip(), description == null || description.isBlank() ? null : description.strip(),
                organizationId, projectId);
        if (rows.isEmpty()) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Project not found");
        return rows.get(0);
    }

    @Transactional
    public void archive(DialogaUser actor, UUID organizationId, UUID projectId) {
        requireAdministrator(actor, organizationId);
        // Soft archive: nessuna cancellazione di dati o assegnazioni. Le letture e
        // la policy esistenti richiedono ACTIVE e negano quindi ogni nuovo accesso.
        // Includere ARCHIVED rende sicuro ripetere la richiesta dopo una risposta persa.
        int matched = jdbc.update("""
                UPDATE dialoga.project SET status = 'ARCHIVED'
                WHERE organization_id = ? AND id = ? AND status IN ('ACTIVE', 'ARCHIVED')
                """, organizationId, projectId);
        if (matched == 0) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Project not found");
    }

    @Transactional
    public Project restore(DialogaUser actor, UUID organizationId, UUID projectId) {
        requireAdministrator(actor, organizationId);
        // Il ripristino riapre il progetto senza ricreare grant o riattivare
        // membership. Revoche, sospensioni e cambi di ruolo già applicati restano
        // validi. Anche il retry su un progetto già attivo restituisce lo stesso ID.
        var rows = jdbc.query("""
                UPDATE dialoga.project SET status = 'ACTIVE'
                WHERE organization_id = ? AND id = ? AND status IN ('ARCHIVED', 'ACTIVE')
                RETURNING id, organization_id, name, slug, description, status
                """, this::map, organizationId, projectId);
        if (rows.isEmpty()) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Project not found");
        return rows.get(0);
    }

    private void requireAdministrator(DialogaUser actor, UUID organizationId) {
        jdbc.queryForObject("SELECT set_config('app.organization_id', ?, true)", String.class, organizationId.toString());
        // Stesso ordine degli accessi ai membri: prima l'organizzazione, poi il
        // progetto. Il lock mantiene validi stato e permessi fino al commit.
        if (jdbc.queryForList("SELECT id FROM dialoga.organization WHERE id = ? AND status = 'ACTIVE' FOR UPDATE", UUID.class, organizationId).isEmpty()) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Organization not found");
        }
        String role = requireOrganization(actor, organizationId, true);
        if (!"OWNER".equals(role) && !"ADMIN".equals(role)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Organization owner or admin required");
        }
    }

    private String requireOrganization(DialogaUser actor, UUID organizationId, boolean lock) {
        jdbc.queryForObject("SELECT set_config('app.organization_id', ?, true)", String.class, organizationId.toString());
        List<String> roles = jdbc.queryForList("""
                SELECT om.role FROM dialoga.organization_membership om
                JOIN dialoga.organization o ON o.id = om.organization_id
                JOIN dialoga.app_user u ON u.id = om.user_id
                WHERE om.organization_id = ? AND om.user_id = ?
                  AND om.status = 'ACTIVE' AND o.status = 'ACTIVE' AND u.status = 'ACTIVE'
                """ + (lock ? " FOR SHARE OF om, o, u" : ""), String.class, organizationId, actor.id());
        if (roles.isEmpty()) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Organization not found");
        return roles.get(0);
    }

    private Project map(java.sql.ResultSet rs, int row) throws java.sql.SQLException {
        return new Project(rs.getObject("id", UUID.class), rs.getObject("organization_id", UUID.class),
                rs.getString("name"), rs.getString("slug"), rs.getString("description"), rs.getString("status"));
    }

    public record Project(UUID id, UUID organizationId, String name, String slug, String description, String status) { }
}
