package it.dialoga.security.organization;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;

import it.dialoga.security.DialogaUser;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.server.ResponseStatusException;

class OrganizationServiceTest {
    @Test void invalidInputIsRejectedBeforeDatabaseAccess() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        var service = new OrganizationService(jdbc);
        var actor = new DialogaUser(UUID.randomUUID(), "owner@example.test", null, null);
        for (String name : new String[] {null, "", "  ", "x".repeat(161)}) {
            assertEquals(400, assertThrows(ResponseStatusException.class,
                    () -> service.create(actor, name, "valid-slug")).getStatusCode().value());
        }
        for (String slug : new String[] {null, "", "UPPER", "-start", "end-", "a--b", "a/b", "a b", "x".repeat(64)}) {
            assertEquals(400, assertThrows(ResponseStatusException.class,
                    () -> service.create(actor, "Valid name", slug)).getStatusCode().value());
        }
        verifyNoInteractions(jdbc);
    }
}
