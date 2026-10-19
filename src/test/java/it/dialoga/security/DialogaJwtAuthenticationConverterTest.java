package it.dialoga.security;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import it.dialoga.security.identity.DialogaIdentityService;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.InvalidBearerTokenException;
class DialogaJwtAuthenticationConverterTest {
    @Test void deniedIdentityIsAnAuthenticationFailureWithGenericPublicMessage() {
        var identities = mock(DialogaIdentityService.class);
        var jwt = Jwt.withTokenValue("test").header("alg", "RS256").subject("test-user").build();
        when(identities.resolve(jwt)).thenThrow(new AccessDeniedException("Internal provisioning denial"));
        var exception = assertThrows(InvalidBearerTokenException.class, () -> new DialogaJwtAuthenticationConverter(identities).convert(jwt));
        assertEquals("invalid_token", exception.getError().getErrorCode());
        assertEquals("Account unavailable", exception.getMessage());
    }
    @Test void validIdentityRemainsTheApplicationPrincipal() {
        var identities = mock(DialogaIdentityService.class);
        var jwt = Jwt.withTokenValue("test").header("alg", "RS256").subject("test-user").build();
        var actor = new DialogaUser(UUID.randomUUID(), "actor@example.test", null, null);
        when(identities.resolve(jwt)).thenReturn(actor);
        var authentication = new DialogaJwtAuthenticationConverter(identities).convert(jwt);
        assertTrue(authentication.isAuthenticated()); assertEquals(actor, authentication.getPrincipal());
    }
}
