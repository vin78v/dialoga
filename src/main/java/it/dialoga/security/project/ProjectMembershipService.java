package it.dialoga.security.project;

import it.dialoga.security.DialogaUser;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/** Assegnazioni esplicite ai progetti: non modificano mai il ruolo nell'organizzazione. */
@Service
public class ProjectMembershipService {
    private static final Set<String> ROLES = Set.of("MANAGER", "EDITOR", "OPERATOR", "VIEWER");
    private final JdbcTemplate jdbc;
    public ProjectMembershipService(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    private static final String MANAGER = """
            SELECT om.role FROM dialoga.organization_membership om
            JOIN dialoga.organization o ON o.id = om.organization_id
            JOIN dialoga.app_user u ON u.id = om.user_id
            WHERE om.organization_id = ? AND om.user_id = ? AND om.status = 'ACTIVE'
              AND o.status = 'ACTIVE' AND u.status = 'ACTIVE'
            """;
    private static final String MEMBERS = """
            SELECT pm.id, pm.user_id, u.email, pm.role, pm.status, om.role AS organization_role,
                   om.status AS organization_status, u.status AS user_status
            FROM dialoga.project_membership pm
            JOIN dialoga.organization_membership om
              ON om.organization_id = pm.organization_id AND om.user_id = pm.user_id
            JOIN dialoga.app_user u ON u.id = pm.user_id
            WHERE pm.organization_id = ? AND pm.project_id = ?
            """;

    @Transactional(readOnly = true)
    public List<Membership> list(DialogaUser actor, UUID org, UUID project) {
        requireManager(actor, org, project, false);
        // Il controllo resta anche nella query finale: un ruolo letto in precedenza
        // non deve autorizzare la lettura di email dopo una revoca concorrente.
        return jdbc.query(MEMBERS + " AND EXISTS (" + MANAGER
                + " AND om.role IN ('OWNER','ADMIN')) ORDER BY lower(u.email), pm.id",
                this::map, org, project, org, actor.id());
    }

    @Transactional
    public Membership assign(DialogaUser actor, UUID org, UUID project, UUID user, String role) {
        if (!ROLES.contains(role == null ? "" : role)) throw error(HttpStatus.BAD_REQUEST, "Invalid project role");
        requireManager(actor, org, project, true);
        requireTarget(org, user, true);
        var previous = jdbc.query("""
                SELECT role, status FROM dialoga.project_membership
                WHERE organization_id = ? AND project_id = ? AND user_id = ? FOR UPDATE
                """, (rs, row) -> new Previous(rs.getString("role"), rs.getString("status")), org, project, user);

        // Un retry dello stesso PUT non cancella grant aggiunti nel frattempo.
        // Nuove assegnazioni, riattivazioni e cambi di ruolo ripartono invece senza
        // grant espliciti: non devono riemergere permessi di una vecchia assegnazione.
        if (previous.isEmpty() || !role.equals(previous.get(0).role()) || !"ACTIVE".equals(previous.get(0).status())) {
            clearGrants(org, project, user);
        }
        jdbc.update("""
                INSERT INTO dialoga.project_membership (organization_id, project_id, user_id, role)
                VALUES (?, ?, ?, ?)
                ON CONFLICT (project_id, user_id) DO UPDATE SET role = EXCLUDED.role, status = 'ACTIVE'
                """, org, project, user, role);
        return jdbc.queryForObject(MEMBERS + " AND pm.user_id = ?", this::map, org, project, user);
    }

    @Transactional
    public void remove(DialogaUser actor, UUID org, UUID project, UUID user) {
        requireManager(actor, org, project, true);
        // La rimozione deve funzionare anche per account o membership organizzazione
        // sospesi; l'assegnazione nuova, al contrario, richiede entrambi attivi.
        requireTarget(org, user, false);
        clearGrants(org, project, user);
        // Conserviamo l'ID per i riferimenti esistenti. ACTIVE -> SUSPENDED revoca
        // subito l'accesso nelle query dei progetti e nel ProjectAuthorizationService.
        jdbc.update("""
                UPDATE dialoga.project_membership SET status = 'SUSPENDED'
                WHERE organization_id = ? AND project_id = ? AND user_id = ?
                """, org, project, user);
    }

    private void requireManager(DialogaUser actor, UUID org, UUID project, boolean lock) {
        jdbc.queryForObject("SELECT set_config('app.organization_id', ?, true)", String.class, org.toString());
        // Ordine dei lock condiviso con gli inviti: organizzazione prima di membri
        // e progetto. Serializza le mutazioni e mantiene validi i controlli fino al commit.
        if (lock && jdbc.queryForList("SELECT id FROM dialoga.organization WHERE id = ? AND status = 'ACTIVE' FOR UPDATE", UUID.class, org).isEmpty()) {
            throw error(HttpStatus.NOT_FOUND, "Organization not found");
        }
        var roles = jdbc.queryForList(MANAGER + (lock ? " FOR SHARE OF om, u" : ""), String.class, org, actor.id());
        if (roles.isEmpty()) throw error(HttpStatus.NOT_FOUND, "Organization not found");
        // MANAGER è un ruolo del progetto, non un amministratore dell'organizzazione.
        if (!Set.of("OWNER", "ADMIN").contains(roles.get(0))) throw error(HttpStatus.FORBIDDEN, "Organization owner or admin required");
        if (jdbc.queryForList("SELECT id FROM dialoga.project WHERE organization_id = ? AND id = ? AND status = 'ACTIVE'"
                + (lock ? " FOR UPDATE" : ""), UUID.class, org, project).isEmpty()) {
            throw error(HttpStatus.NOT_FOUND, "Project not found");
        }
    }

    private void requireTarget(UUID org, UUID user, boolean assigning) {
        var rows = jdbc.query("""
                SELECT om.role, om.status, u.status AS user_status
                FROM dialoga.organization_membership om JOIN dialoga.app_user u ON u.id = om.user_id
                WHERE om.organization_id = ? AND om.user_id = ? FOR SHARE OF om, u
                """, (rs, row) -> new Target(rs.getString("role"), rs.getString("status"), rs.getString("user_status")), org, user);
        if (rows.isEmpty()) throw error(HttpStatus.NOT_FOUND, "Organization member not found");
        var target = rows.get(0);
        // OWNER/ADMIN vedono già tutti i progetti: una membership esplicita non può
        // limitarli. Rifiutiamo operazioni che farebbero credere il contrario alla UI.
        if (!"MEMBER".equals(target.role())) throw error(HttpStatus.CONFLICT, "Organization administrators have implicit project access");
        if (assigning && (!"ACTIVE".equals(target.status()) || !"ACTIVE".equals(target.userStatus()))) {
            throw error(HttpStatus.CONFLICT, "An active organization member is required");
        }
    }

    private void clearGrants(UUID org, UUID project, UUID user) {
        // Esistono due sorgenti di grant: per membership (V1) e per utente (V4).
        // Pulirne soltanto una ripristinerebbe privilegi inattesi alla riattivazione.
        jdbc.update("""
                DELETE FROM dialoga.project_permission WHERE organization_id = ? AND project_id = ?
                AND project_membership_id IN (SELECT id FROM dialoga.project_membership
                  WHERE organization_id = ? AND project_id = ? AND user_id = ?)
                """, org, project, org, project, user);
        jdbc.update("DELETE FROM dialoga.project_user_permission WHERE organization_id = ? AND project_id = ? AND user_id = ?", org, project, user);
    }
    private Membership map(ResultSet rs, int row) throws SQLException {
        return new Membership(rs.getObject("id", UUID.class), rs.getObject("user_id", UUID.class), rs.getString("email"),
                rs.getString("role"), rs.getString("status"), rs.getString("organization_role"), rs.getString("organization_status"), rs.getString("user_status"));
    }
    private static ResponseStatusException error(HttpStatus status, String message) { return new ResponseStatusException(status, message); }
    private record Previous(String role, String status) { }
    private record Target(String role, String status, String userStatus) { }
    public record Membership(UUID id, UUID userId, String email, String role, String status, String organizationRole, String organizationMembershipStatus, String userStatus) { }
}
