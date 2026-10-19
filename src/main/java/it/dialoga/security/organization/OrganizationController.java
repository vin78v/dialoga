package it.dialoga.security.organization;

import it.dialoga.security.DialogaUser;
import java.net.URI;
import java.util.UUID;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/organizations")
public class OrganizationController {
    private final OrganizationService organizations;

    public OrganizationController(OrganizationService organizations) { this.organizations = organizations; }

    @PostMapping
    public ResponseEntity<OrganizationService.Organization> create(
            @AuthenticationPrincipal DialogaUser actor, @RequestBody CreateOrganization request) {
        var organization = organizations.create(actor, request.name(), request.slug());
        return ResponseEntity.created(URI.create("/api/organizations/" + organization.id())).body(organization);
    }

    @GetMapping("/{id}")
    public OrganizationService.Organization get(@AuthenticationPrincipal DialogaUser actor, @PathVariable UUID id) {
        return organizations.get(actor, id);
    }

    public record CreateOrganization(String name, String slug) { }
}
