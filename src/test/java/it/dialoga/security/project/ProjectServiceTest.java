package it.dialoga.security.project;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import it.dialoga.security.DialogaUser;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.server.ResponseStatusException;

class ProjectServiceTest {
    @Test void invalidInputDoesNotReachDatabase() {
        var jdbc = mock(JdbcTemplate.class);
        var service = new ProjectService(jdbc);
        var actor = new DialogaUser(UUID.randomUUID(), "test@example.test", null, null);
        var org = UUID.randomUUID();
        for (String name : new String[] {null, "", " ", "x".repeat(161)}) {
            assertEquals(400, assertThrows(ResponseStatusException.class,
                    () -> service.create(actor, org, name, "valid-slug", null)).getStatusCode().value());
        }
        for (String slug : new String[] {null, "", "UPPER", "a--b", "-a", "a-", "a/b", "x".repeat(64)}) {
            assertEquals(400, assertThrows(ResponseStatusException.class,
                    () -> service.create(actor, org, "Name", slug, null)).getStatusCode().value());
        }
        assertEquals(400, assertThrows(ResponseStatusException.class,
                () -> service.create(actor, org, "Name", "slug", "x".repeat(2001))).getStatusCode().value());
        verifyNoInteractions(jdbc);
    }
    @Test void invalidMetadataUpdateDoesNotReachDatabase() {
        var jdbc = mock(JdbcTemplate.class);
        var service = new ProjectService(jdbc);
        var actor = new DialogaUser(UUID.randomUUID(), "test@example.test", null, null);
        for (String name : new String[] {null, "", " ", "x".repeat(161)}) {
            assertEquals(400, assertThrows(ResponseStatusException.class,
                    () -> service.update(actor, UUID.randomUUID(), UUID.randomUUID(), name, null)).getStatusCode().value());
        }
        assertEquals(400, assertThrows(ResponseStatusException.class,
                () -> service.update(actor, UUID.randomUUID(), UUID.randomUUID(), "Name", "x".repeat(2001))).getStatusCode().value());
        verifyNoInteractions(jdbc);
    }

}
