package it.dialoga.security.assistant;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import it.dialoga.security.DialogaUser;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.server.ResponseStatusException;

/** Gli input non validi non devono aprire alcun accesso al database. */
class AssistantServiceTest {
    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final AssistantService assistants = new AssistantService(jdbc);
    private final DialogaUser actor = new DialogaUser(UUID.randomUUID(), "actor@example.test", null, null);
    private final UUID org = UUID.randomUUID(), project = UUID.randomUUID(), assistant = UUID.randomUUID();

    @Test void invalidDraftContentIsRejectedBeforeDatabaseAccess() {
        for (String name : new String[] {null, "", " ", "x".repeat(161)}) {
            badRequest(() -> assistants.create(actor, org, project, name, "Istruzioni", null));
            badRequest(() -> assistants.update(actor, org, project, assistant, name, "Istruzioni", null, 0L));
        }
        for (String instructions : new String[] {null, "", " ", "x".repeat(12001)}) {
            badRequest(() -> assistants.create(actor, org, project, "Nome", instructions, null));
            badRequest(() -> assistants.update(actor, org, project, assistant, "Nome", instructions, null, 0L));
        }
        // Il limite del messaggio iniziale si applica prima del trim, evitando
        // payload enormi composti quasi soltanto da spazi.
        for (String welcome : new String[] {"x".repeat(1001), " ".repeat(1001)}) {
            badRequest(() -> assistants.create(actor, org, project, "Nome", "Istruzioni", welcome));
            badRequest(() -> assistants.update(actor, org, project, assistant, "Nome", "Istruzioni", welcome, 0L));
        }
        verifyNoInteractions(jdbc);
    }

    @Test void missingNegativeAndUnsafeExpectedVersionsAreRejectedBeforeDatabaseAccess() {
        // La versione deve poter essere incrementata e rappresentata senza
        // perdita di precisione anche dal numero JavaScript della console.
        for (Long version : new Long[] {null, -1L, 9007199254740991L, Long.MAX_VALUE}) {
            badRequest(() -> assistants.update(actor, org, project, assistant, "Nome", "Istruzioni", null, version));
        }
        verifyNoInteractions(jdbc);
    }

    private void badRequest(Runnable action) {
        assertEquals(400, assertThrows(ResponseStatusException.class, action::run).getStatusCode().value());
    }
}
