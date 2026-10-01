package it.dialoga.security;

import it.dialoga.security.identity.DialogaIdentityService;
import org.springframework.core.convert.converter.Converter;
import org.springframework.security.authentication.AbstractAuthenticationToken;
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
        return new DialogaJwtAuthenticationToken(identityService.resolve(jwt), jwt);
    }
}
