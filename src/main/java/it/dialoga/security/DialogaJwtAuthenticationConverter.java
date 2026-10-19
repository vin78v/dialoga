package it.dialoga.security;

import it.dialoga.security.identity.DialogaIdentityService;
import org.springframework.core.convert.converter.Converter;
import org.springframework.security.authentication.AbstractAuthenticationToken;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.oauth2.server.resource.InvalidBearerTokenException;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Component;

@Component
public class DialogaJwtAuthenticationConverter implements Converter<Jwt, AbstractAuthenticationToken> {
    private final DialogaIdentityService identityService;

    public DialogaJwtAuthenticationConverter(DialogaIdentityService identityService) {
        this.identityService = identityService;
    }

    @Override
    public AbstractAuthenticationToken convert(Jwt jwt) {
        try {
            return new DialogaJwtAuthenticationToken(identityService.resolve(jwt), jwt);
        } catch (AccessDeniedException denied) {
            // Authentication failures (including unverified first access) must be
            // handled by the bearer-token entry point rather than become HTTP 500.
            throw new InvalidBearerTokenException("Account unavailable", denied);
        }
    }
}
