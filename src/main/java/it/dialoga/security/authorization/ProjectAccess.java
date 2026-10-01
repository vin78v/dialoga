package it.dialoga.security.authorization;

import java.util.Set;
import java.util.UUID;

public record ProjectAccess(
        UUID userId,
        UUID organizationId,
        UUID projectId,
        String organizationRole,
        String projectRole,
        UUID projectMembershipId,
        Set<String> explicitPermissions) { }
