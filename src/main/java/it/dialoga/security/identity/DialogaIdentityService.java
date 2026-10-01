package it.dialoga.security.identity;

import it.dialoga.security.DialogaUser;
import java.sql.PreparedStatement;
import java.util.UUID;
import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.jdbc.core.ConnectionCallback;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

@Service
public class DialogaIdentityService {
    private final JdbcTemplate jdbc;

    public DialogaIdentityService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** Called for every authenticated request; provisioning is serialized only on a first-login miss. */
    @Transactional
    public DialogaUser resolve(Jwt jwt) {
        String issuer = jwt.getIssuer() == null ? null : jwt.getIssuer().toString();
        String subject = jwt.getSubject();
        if (!StringUtils.hasText(issuer) || !StringUtils.hasText(subject)) {
            throw new AccessDeniedException("Invalid identity token");
        }

        DialogaUser user = find(issuer, subject);
        if (user == null) {
            lockIdentity(issuer + "\n" + subject);
            user = find(issuer, subject);
            if (user == null) {
                user = provision(jwt, issuer, subject);
            }
        }
        return user;
    }

    private DialogaUser find(String issuer, String subject) {
        try {
            return jdbc.queryForObject("""
                    SELECT u.id, u.email, u.first_name, u.last_name, u.status
                    FROM dialoga.user_identity i
                    JOIN dialoga.app_user u ON u.id = i.user_id
                    WHERE i.issuer = ? AND i.subject = ?
                    """, (rs, row) -> {
                String status = rs.getString("status");
                if (!"ACTIVE".equals(status)) {
                    throw new AccessDeniedException("Account unavailable");
                }
                return new DialogaUser(rs.getObject("id", UUID.class), rs.getString("email"),
                        rs.getString("first_name"), rs.getString("last_name"));
            }, issuer, subject);
        } catch (EmptyResultDataAccessException missing) {
            return null;
        }
    }

    private DialogaUser provision(Jwt jwt, String issuer, String subject) {
        String email = jwt.getClaimAsString("email");
        Boolean emailVerified = jwt.getClaimAsBoolean("email_verified");
        if (!Boolean.TRUE.equals(emailVerified) || !StringUtils.hasText(email)) {
            throw new AccessDeniedException("A verified email is required for first access");
        }

        UUID userId = jdbc.queryForObject("""
                INSERT INTO dialoga.app_user (email, first_name, last_name, last_login_at)
                VALUES (?, ?, ?, now())
                RETURNING id
                """, UUID.class, email,
                jwt.getClaimAsString("given_name"), jwt.getClaimAsString("family_name"));
        jdbc.update("""
                INSERT INTO dialoga.user_identity (user_id, issuer, subject)
                VALUES (?, ?, ?)
                """, userId, issuer, subject);
        return new DialogaUser(userId, email, jwt.getClaimAsString("given_name"),
                jwt.getClaimAsString("family_name"));
    }

    private void lockIdentity(String identityKey) {
        jdbc.execute((ConnectionCallback<Void>) connection -> {
            try (PreparedStatement statement = connection.prepareStatement(
                    "SELECT pg_advisory_xact_lock(hashtextextended(?, 0))")) {
                statement.setString(1, identityKey);
                statement.execute();
            }
            return null;
        });
    }
}
