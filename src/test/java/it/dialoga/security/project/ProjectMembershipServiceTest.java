package it.dialoga.security.project;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import it.dialoga.security.DialogaUser;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.server.ResponseStatusException;
class ProjectMembershipServiceTest {
    @Test void organizationRolesAndUnknownRolesAreRejectedBeforeDatabaseAccess() {
        var jdbc = mock(JdbcTemplate.class); var service = new ProjectMembershipService(jdbc);
        var actor = new DialogaUser(UUID.randomUUID(), "actor@example.test", null, null);
        for (String role : new String[] {null, "", "OWNER", "ADMIN", "viewer", "unknown"}) {
            assertEquals(400, assertThrows(ResponseStatusException.class,
                    () -> service.assign(actor, UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), role)).getStatusCode().value());
        }
        verifyNoInteractions(jdbc);
    }
}
