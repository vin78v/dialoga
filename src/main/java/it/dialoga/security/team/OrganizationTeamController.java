package it.dialoga.security.team;

import it.dialoga.security.DialogaUser;
import it.dialoga.security.DialogaJwtAuthenticationToken;
import it.dialoga.security.organization.OrganizationService.Organization;
import java.net.URI;
import java.util.List;
import java.util.UUID;
import org.springframework.http.*;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/organizations/{organizationId}")
public class OrganizationTeamController {
    private final OrganizationTeamService team;
    public OrganizationTeamController(OrganizationTeamService team) { this.team = team; }
    @GetMapping("/members")
    public ResponseEntity<List<OrganizationTeamService.Member>> members(@AuthenticationPrincipal DialogaUser actor, @PathVariable UUID organizationId) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(team.members(actor, organizationId));
    }
    @GetMapping("/invites")
    public ResponseEntity<List<OrganizationTeamService.Invite>> invites(@AuthenticationPrincipal DialogaUser actor, @PathVariable UUID organizationId) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(team.invites(actor, organizationId));
    }
    @GetMapping("/invites/{inviteId}")
    public ResponseEntity<OrganizationTeamService.Invite> getInvite(@AuthenticationPrincipal DialogaUser actor,
            @PathVariable UUID organizationId, @PathVariable UUID inviteId) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(team.getInvite(actor, organizationId, inviteId));
    }
    @PostMapping("/invites")
    public ResponseEntity<OrganizationTeamService.CreatedInvite> create(@AuthenticationPrincipal DialogaUser actor,
            @PathVariable UUID organizationId, @RequestBody CreateInvite request) {
        var created = team.create(actor, organizationId, request.email(), request.role());
        return ResponseEntity.created(URI.create("/api/organizations/" + organizationId + "/invites/" + created.invite().id()))
                .cacheControl(CacheControl.noStore()).body(created);
    }
    @DeleteMapping("/invites/{inviteId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void revoke(@AuthenticationPrincipal DialogaUser actor, @PathVariable UUID organizationId, @PathVariable UUID inviteId) {
        team.revoke(actor, organizationId, inviteId);
    }
    @PostMapping("/invites/{inviteId}/accept")
    public ResponseEntity<Organization> accept(@AuthenticationPrincipal DialogaUser actor, Authentication authentication,
            @PathVariable UUID organizationId, @PathVariable UUID inviteId, @RequestBody AcceptInvite request) {
        if (!(authentication instanceof DialogaJwtAuthenticationToken token)) throw new ResponseStatusException(HttpStatus.UNAUTHORIZED);
        var jwt = token.getJwt();
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(team.accept(actor, organizationId, inviteId, request.token(),
                jwt.getClaimAsString("email"), Boolean.TRUE.equals(jwt.getClaimAsBoolean("email_verified"))));
    }
    public record CreateInvite(String email, String role) { }
    public record AcceptInvite(String token) { }
}
