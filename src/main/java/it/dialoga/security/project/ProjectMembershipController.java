package it.dialoga.security.project;

import it.dialoga.security.DialogaUser;
import java.util.List;
import java.util.UUID;
import org.springframework.http.*;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

/** I parametri del percorso fissano il tenant; il JSON può scegliere soltanto il ruolo. */
@RestController
@RequestMapping("/api/organizations/{organizationId}/projects/{projectId}/members")
public class ProjectMembershipController {
    private final ProjectMembershipService memberships;
    public ProjectMembershipController(ProjectMembershipService memberships) { this.memberships = memberships; }

    @GetMapping
    public ResponseEntity<List<ProjectMembershipService.Membership>> list(@AuthenticationPrincipal DialogaUser actor,
            @PathVariable UUID organizationId, @PathVariable UUID projectId) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(memberships.list(actor, organizationId, projectId));
    }
    // PUT esprime lo stato desiderato ed è idempotente, anche su una membership sospesa.
    @PutMapping("/{userId}")
    public ResponseEntity<ProjectMembershipService.Membership> assign(@AuthenticationPrincipal DialogaUser actor,
            @PathVariable UUID organizationId, @PathVariable UUID projectId, @PathVariable UUID userId, @RequestBody AssignMember request) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(memberships.assign(actor, organizationId, projectId, userId, request.role()));
    }
    @DeleteMapping("/{userId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void remove(@AuthenticationPrincipal DialogaUser actor, @PathVariable UUID organizationId, @PathVariable UUID projectId, @PathVariable UUID userId) {
        memberships.remove(actor, organizationId, projectId, userId);
    }
    public record AssignMember(String role) { }
}
