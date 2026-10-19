package it.dialoga.security.team;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import it.dialoga.security.DialogaUser;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.server.ResponseStatusException;
class OrganizationTeamServiceTest {
    @Test void invalidInputDoesNotReachDatabase() {
        var jdbc = mock(JdbcTemplate.class); var service = new OrganizationTeamService(jdbc);
        var actor = new DialogaUser(UUID.randomUUID(), "actor@example.test", null, null); var org = UUID.randomUUID();
        for (String email : new String[] {null, "", "not-email", "x@y", "a b@example.test", "a\nb@example.test", "a".repeat(250) + "@example.test"}) {
            assertEquals(400, assertThrows(ResponseStatusException.class, () -> service.create(actor, org, email, "MEMBER")).getStatusCode().value());
        }
        for (String role : new String[] {null, "OWNER", "unknown"}) {
            assertEquals(400, assertThrows(ResponseStatusException.class, () -> service.create(actor, org, "a@example.test", role)).getStatusCode().value());
        }
        for (String token : new String[] {null, "short", "!".repeat(43)}) {
            assertEquals(404, assertThrows(ResponseStatusException.class, () -> service.accept(actor, org, UUID.randomUUID(), token, actor.email(), true)).getStatusCode().value());
        }
        verifyNoInteractions(jdbc);
    }
}
