package it.dialoga.security.team;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import it.dialoga.security.*;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.security.core.Authentication;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.server.ResponseStatusException;
class OrganizationTeamControllerTest {
    @Test void acceptanceUsesCurrentVerifiedJwtEmailNotStoredProfile() {
        var team = mock(OrganizationTeamService.class); var controller = new OrganizationTeamController(team);
        var actor = new DialogaUser(UUID.randomUUID(), "stale@example.test", null, null);
        UUID org = UUID.randomUUID(), invite = UUID.randomUUID(); String secret = "A".repeat(43);
        for (boolean verified : new boolean[] {true, false}) {
            var jwt = Jwt.withTokenValue("test").header("alg", "RS256").claim("email", "current@example.test").claim("email_verified", verified).build();
            controller.accept(actor, new DialogaJwtAuthenticationToken(actor, jwt), org, invite, new OrganizationTeamController.AcceptInvite(secret));
            verify(team).accept(actor, org, invite, secret, "current@example.test", verified);
        }
    }
    @Test void unrelatedAuthenticationCannotAccept() {
        var team = mock(OrganizationTeamService.class); var controller = new OrganizationTeamController(team);
        var actor = new DialogaUser(UUID.randomUUID(), "actor@example.test", null, null);
        assertEquals(401, assertThrows(ResponseStatusException.class, () -> controller.accept(actor, mock(Authentication.class), UUID.randomUUID(), UUID.randomUUID(), new OrganizationTeamController.AcceptInvite("A".repeat(43)))).getStatusCode().value());
        verifyNoInteractions(team);
    }
}
