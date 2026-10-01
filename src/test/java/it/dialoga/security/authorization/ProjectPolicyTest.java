package it.dialoga.security.authorization;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class ProjectPolicyTest {
    private ProjectAccess access(String orgRole, String projectRole, String... grants) {
        return new ProjectAccess(UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(),
                orgRole, projectRole, UUID.randomUUID(), Set.of(grants));
    }

    @Test void editorNeedsExplicitGrantToPublish() {
        assertFalse(ProjectPolicy.allows(access("MEMBER", "EDITOR"), ProjectAction.PUBLISH_ASSISTANT));
        assertTrue(ProjectPolicy.allows(access("MEMBER", "EDITOR", "ASSISTANT_PUBLISH"),
                ProjectAction.PUBLISH_ASSISTANT));
    }

    @Test void operatorCanReadConversationsButNotContactsByDefault() {
        ProjectAccess operator = access("MEMBER", "OPERATOR");
        assertTrue(ProjectPolicy.allows(operator, ProjectAction.READ_CONVERSATIONS));
        assertFalse(ProjectPolicy.allows(operator, ProjectAction.READ_CONTACTS));
    }

    @Test void elevatedRoleStillNeedsExplicitPersonalDataExportGrant() {
        assertFalse(ProjectPolicy.allows(access("OWNER", null), ProjectAction.EXPORT_CONTACTS));
        assertTrue(ProjectPolicy.allows(access("OWNER", null, "PERSONAL_DATA_EXPORT"),
                ProjectAction.EXPORT_CONTACTS));
    }

    @Test void exportRequiresBothExplicitGrantAndReadRightForThatData() {
        ProjectAccess operator = access("MEMBER", "OPERATOR", "PERSONAL_DATA_EXPORT");
        assertTrue(ProjectPolicy.allows(operator, ProjectAction.EXPORT_CONVERSATIONS));
        assertFalse(ProjectPolicy.allows(operator, ProjectAction.EXPORT_CONTACTS));
    }

    @Test void viewerCanViewButCannotEdit() {
        ProjectAccess viewer = access("MEMBER", "VIEWER");
        assertTrue(ProjectPolicy.allows(viewer, ProjectAction.VIEW));
        assertFalse(ProjectPolicy.allows(viewer, ProjectAction.EDIT_CONFIGURATION));
    }
}
