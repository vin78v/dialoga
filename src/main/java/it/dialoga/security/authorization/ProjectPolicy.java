package it.dialoga.security.authorization;

import java.util.Set;

public final class ProjectPolicy {
    private ProjectPolicy() { }

    public static boolean allows(ProjectAccess access, ProjectAction action) {
        String org = access.organizationRole();
        String project = access.projectRole();
        Set<String> grants = access.explicitPermissions();
        boolean ownerOrAdmin = "OWNER".equals(org) || "ADMIN".equals(org);
        boolean manager = ownerOrAdmin || "MANAGER".equals(project);

        return switch (action) {
            case VIEW -> true; // ProjectAccess exists only after active membership/scope validation.
            case EDIT_CONFIGURATION -> manager || "EDITOR".equals(project);
            case PUBLISH_ASSISTANT -> manager || grants.contains("ASSISTANT_PUBLISH");
            case READ_CONVERSATIONS -> manager || "OPERATOR".equals(project)
                    || grants.contains("CONVERSATION_READ");
            case READ_CONTACTS -> manager || grants.contains("CONTACT_READ");
            case EXPORT_CONVERSATIONS -> grants.contains("PERSONAL_DATA_EXPORT")
                    && (manager || "OPERATOR".equals(project)
                    || grants.contains("CONVERSATION_READ"));
            case EXPORT_CONTACTS -> grants.contains("PERSONAL_DATA_EXPORT")
                    && (manager || grants.contains("CONTACT_READ"));
            case MANAGE_INTEGRATIONS -> manager || grants.contains("INTEGRATION_MANAGE");
        };
    }
}
