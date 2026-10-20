package it.dialoga.security.assistant;

import it.dialoga.security.DialogaUser;
import it.dialoga.security.authorization.ProjectAccess;
import it.dialoga.security.authorization.ProjectAction;
import it.dialoga.security.authorization.ProjectPolicy;
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

/** Gestione persistente delle bozze; non pubblica versioni né avvia conversazioni. */
@Service
public class AssistantService {
    private final JdbcTemplate jdbc;
    public AssistantService(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    private static final String ACCESS = """
            SELECT om.role AS organization_role, pm.role AS project_role, pm.id AS membership_id
            FROM dialoga.organization o
            JOIN dialoga.project p ON p.organization_id = o.id AND p.id = ? AND p.status = 'ACTIVE'
            JOIN dialoga.organization_membership om ON om.organization_id = o.id AND om.user_id = ? AND om.status = 'ACTIVE'
            JOIN dialoga.app_user u ON u.id = om.user_id AND u.status = 'ACTIVE'
            LEFT JOIN dialoga.project_membership pm ON pm.organization_id = o.id AND pm.project_id = p.id
              AND pm.user_id = u.id AND pm.status = 'ACTIVE'
            WHERE o.id = ? AND o.status = 'ACTIVE' AND (om.role IN ('OWNER', 'ADMIN') OR pm.id IS NOT NULL)
            """;
    private static final String COLUMNS = """
            a.id, a.organization_id, a.project_id, a.name, a.status, a.draft_lock_version,
            COALESCE(a.draft_config->>'instructions', '') AS instructions,
            a.draft_config->>'welcomeMessage' AS welcome_message
            """;

    @Transactional(readOnly = true)
    public Listing list(DialogaUser actor, UUID org, UUID project) {
        boolean canEdit = scope(actor, org, project, false);
        // La query finale ricontrolla l'accesso: una revoca dopo il precontrollo
        // non deve esporre nemmeno l'elenco degli assistenti di un altro contesto.
        var items = jdbc.query("SELECT a.id, a.organization_id, a.project_id, a.name, a.status, a.draft_lock_version "
                + "FROM dialoga.assistant a WHERE a.organization_id = ? AND a.project_id = ? AND EXISTS ("
                + ACCESS + ") ORDER BY a.created_at DESC, a.id", (rs, row) -> summary(rs), org, project, project, actor.id(), org);
        return new Listing(canEdit, items);
    }

    @Transactional(readOnly = true)
    public Details get(DialogaUser actor, UUID org, UUID project, UUID assistant) {
        boolean canEdit = scope(actor, org, project, false);
        var rows = jdbc.query("SELECT " + COLUMNS + " FROM dialoga.assistant a "
                + "WHERE a.organization_id = ? AND a.project_id = ? AND a.id = ? AND EXISTS (" + ACCESS + ")",
                (rs, row) -> details(rs, canEdit), org, project, assistant, project, actor.id(), org);
        if (rows.isEmpty()) throw error(HttpStatus.NOT_FOUND, "Assistant not found");
        return rows.get(0);
    }

    @Transactional
    public Details create(DialogaUser actor, UUID org, UUID project, String name, String instructions, String welcomeMessage) {
        var input = validate(name, instructions, welcomeMessage);
        requireEditor(actor, org, project);
        return jdbc.queryForObject("""
                INSERT INTO dialoga.assistant AS a (organization_id, project_id, name, draft_config)
                VALUES (?, ?, ?, jsonb_build_object('instructions', ?::text, 'welcomeMessage', ?::text))
                RETURNING
                """ + COLUMNS, (rs, row) -> details(rs, true), org, project, input.name(), input.instructions(), input.welcomeMessage());
    }

    @Transactional
    public Details update(DialogaUser actor, UUID org, UUID project, UUID assistant,
            String name, String instructions, String welcomeMessage, Long expectedVersion) {
        var input = validate(name, instructions, welcomeMessage);
        // Manteniamo il contatore rappresentabile esattamente anche dal client JS.
        if (expectedVersion == null || expectedVersion < 0 || expectedVersion > 9_007_199_254_740_990L) {
            throw error(HttpStatus.BAD_REQUEST, "Invalid draft version");
        }
        requireEditor(actor, org, project);
        // La versione attesa impedisce di sovrascrivere il salvataggio di un altro
        // editor. Modifichiamo soltanto le chiavi gestite da questa schermata,
        // conservando eventuali configurazioni future e lo stato di pubblicazione.
        var rows = jdbc.query("""
                UPDATE dialoga.assistant AS a SET name = ?,
                  draft_config = draft_config || jsonb_build_object('instructions', ?::text, 'welcomeMessage', ?::text),
                  draft_lock_version = draft_lock_version + 1
                WHERE organization_id = ? AND project_id = ? AND id = ?
                  AND status = 'DRAFT' AND draft_lock_version = ?
                RETURNING
                """ + COLUMNS, (rs, row) -> details(rs, true), input.name(), input.instructions(), input.welcomeMessage(),
                org, project, assistant, expectedVersion);
        if (!rows.isEmpty()) return rows.get(0);
        if (jdbc.queryForList("SELECT id FROM dialoga.assistant WHERE organization_id = ? AND project_id = ? AND id = ?", UUID.class, org, project, assistant).isEmpty()) {
            throw error(HttpStatus.NOT_FOUND, "Assistant not found");
        }
        throw error(HttpStatus.CONFLICT, "Draft changed or assistant is no longer editable");
    }

    private void requireEditor(DialogaUser actor, UUID org, UUID project) {
        if (!scope(actor, org, project, true)) throw error(HttpStatus.FORBIDDEN, "Project configuration permission required");
    }
    private boolean scope(DialogaUser actor, UUID org, UUID project, boolean lock) {
        jdbc.queryForObject("SELECT set_config('app.organization_id', ?, true)", String.class, org.toString());
        // Ordine condiviso con progetti e team: l'organizzazione viene bloccata
        // prima di leggere i ruoli. Revoche e archiviazioni via API si serializzano
        // con la scrittura; i lock condivisi proteggono anche lo stato dell'account.
        if (lock && jdbc.queryForList("SELECT id FROM dialoga.organization WHERE id = ? AND status = 'ACTIVE' FOR UPDATE", UUID.class, org).isEmpty()) {
            throw error(HttpStatus.NOT_FOUND, "Organization not found");
        }
        var access = jdbc.query(ACCESS + (lock ? " FOR SHARE OF om, u, p" : ""),
                (rs, row) -> new ProjectAccess(actor.id(), org, project, rs.getString("organization_role"),
                        rs.getString("project_role"), rs.getObject("membership_id", UUID.class), Set.of()), project, actor.id(), org);
        if (access.isEmpty()) throw error(HttpStatus.NOT_FOUND, "Project not found");
        // EDIT_CONFIGURATION dipende soltanto dai ruoli nella policy esistente;
        // un grant di pubblicazione non abilita la modifica della configurazione.
        return ProjectPolicy.allows(access.get(0), ProjectAction.EDIT_CONFIGURATION);
    }

    private static Input validate(String name, String instructions, String welcomeMessage) {
        String cleanName = required(name, 160, "name");
        String cleanInstructions = required(instructions, 12000, "instructions");
        if (welcomeMessage != null && (welcomeMessage.length() > 1000 || welcomeMessage.indexOf('\0') >= 0)) {
            throw error(HttpStatus.BAD_REQUEST, "Invalid welcome message");
        }
        return new Input(cleanName, cleanInstructions, welcomeMessage == null || welcomeMessage.isBlank() ? null : welcomeMessage.strip());
    }
    private static String required(String value, int max, String field) {
        if (value == null || value.isBlank() || value.strip().length() > max || value.indexOf('\0') >= 0) {
            throw error(HttpStatus.BAD_REQUEST, "Invalid assistant " + field);
        }
        return value.strip();
    }
    private Summary summary(ResultSet rs) throws SQLException {
        return new Summary(rs.getObject("id", UUID.class), rs.getObject("organization_id", UUID.class), rs.getObject("project_id", UUID.class),
                rs.getString("name"), rs.getString("status"), rs.getLong("draft_lock_version"));
    }
    private Details details(ResultSet rs, boolean canEdit) throws SQLException {
        var item = summary(rs);
        return new Details(item.id(), item.organizationId(), item.projectId(), item.name(), item.status(),
                rs.getString("instructions"), rs.getString("welcome_message"), item.draftLockVersion(), canEdit && "DRAFT".equals(item.status()));
    }
    private static ResponseStatusException error(HttpStatus status, String message) { return new ResponseStatusException(status, message); }
    private record Input(String name, String instructions, String welcomeMessage) { }
    public record Listing(boolean canEdit, List<Summary> items) { }
    public record Summary(UUID id, UUID organizationId, UUID projectId, String name, String status, long draftLockVersion) { }
    public record Details(UUID id, UUID organizationId, UUID projectId, String name, String status, String instructions, String welcomeMessage, long draftLockVersion, boolean canEdit) { }
}
