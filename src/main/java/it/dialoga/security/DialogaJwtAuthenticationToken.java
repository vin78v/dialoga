package it.dialoga.security;

import java.util.Collection;
import java.util.List;
import org.springframework.security.authentication.AbstractAuthenticationToken;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.oauth2.jwt.Jwt;

/** Principal backed by Dialoga's database identity; token roles are intentionally ignored. */
public final class DialogaJwtAuthenticationToken extends AbstractAuthenticationToken {
    private final DialogaUser principal;
    private final Jwt jwt;

    public DialogaJwtAuthenticationToken(DialogaUser principal, Jwt jwt) {
        super(List.<GrantedAuthority>of());
        this.principal = principal;
        this.jwt = jwt;
        setAuthenticated(true);
    }

    @Override public DialogaUser getPrincipal() { return principal; }
    @Override public Object getCredentials() { return ""; }
    public Jwt getJwt() { return jwt; }
}
