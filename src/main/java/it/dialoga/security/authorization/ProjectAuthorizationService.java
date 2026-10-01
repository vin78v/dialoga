package it.dialoga.security.authorization;

import it.dialoga.security.DialogaUser;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ProjectAuthorizationService {
    private final JdbcTemplate jdbc;

    public ProjectAuthorizationService(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    @Transactional(readOnly = true)
    public void require(DialogaUser actor, UUID organizationId, UUID projectId, ProjectAction action) {
        // V3 RLS reads this transaction-local tenant context. It is harmless if V3 is not installed.
        jdbc.queryForObject("SELECT set_config('app.organization_id', ?, true)",
                String.class, organizationId.toString());

        List<ProjectAccess> rows = jdbc.query("""
                SELECT om.role AS organization_role,
                       pm.role AS project_role,
                       pm.id AS project_membership_id
                FROM dialoga.app_user u
                JOIN dialoga.organization_membership om
                  ON om.user_id = u.id AND om.organization_id = ? AND om.status = 'ACTIVE'
                JOIN dialoga.organization o
                  ON o.id = om.organization_id AND o.status = 'ACTIVE'
                JOIN dialoga.project p
                  ON p.id = ? AND p.organization_id = om.organization_id AND p.status = 'ACTIVE'
                LEFT JOIN dialoga.project_membership pm
                  ON pm.organization_id = p.organization_id AND pm.project_id = p.id
                 AND pm.user_id = u.id AND pm.status = 'ACTIVE'
                WHERE u.id = ? AND u.status = 'ACTIVE'
                  AND (om.role IN ('OWNER','ADMIN') OR pm.id IS NOT NULL)
                """, (rs, row) -> new ProjectAccess(actor.id(), organizationId, projectId,
                rs.getString("organization_role"), rs.getString("project_role"),
                rs.getObject("project_membership_id", UUID.class), Set.of()),
                organizationId, projectId, actor.id());

        if (rows.isEmpty()) throw new AccessDeniedException("Project access denied");
        ProjectAccess base = rows.get(0);
        Set<String> grants = new HashSet<>();
        if (base.projectMembershipId() != null) {
            grants.addAll(jdbc.queryForList("""
                    SELECT permission FROM dialoga.project_permission
                    WHERE organization_id = ? AND project_id = ? AND project_membership_id = ?
                    """, String.class, organizationId, projectId, base.projectMembershipId()));
        }
        grants.addAll(jdbc.queryForList("""
                SELECT permission FROM dialoga.project_user_permission
                WHERE organization_id = ? AND project_id = ? AND user_id = ?
                """, String.class, organizationId, projectId, actor.id()));

        ProjectAccess access = new ProjectAccess(actor.id(), organizationId, projectId,
                base.organizationRole(), base.projectRole(), base.projectMembershipId(), Set.copyOf(grants));
        if (!ProjectPolicy.allows(access, action)) {
            throw new AccessDeniedException("Project action denied");
        }
    }
}
