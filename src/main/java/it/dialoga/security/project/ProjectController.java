package it.dialoga.security.project;

import it.dialoga.security.DialogaUser;
import java.net.URI;
import java.util.List;
import java.util.UUID;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/organizations/{organizationId}/projects")
public class ProjectController {
    private final ProjectService projects;
    public ProjectController(ProjectService projects) { this.projects = projects; }

    @GetMapping
    public List<ProjectService.Project> list(@AuthenticationPrincipal DialogaUser actor, @PathVariable UUID organizationId) {
        return projects.list(actor, organizationId);
    }

    @GetMapping("/{projectId}")
    public ProjectService.Project get(@AuthenticationPrincipal DialogaUser actor,
            @PathVariable UUID organizationId, @PathVariable UUID projectId) {
        return projects.get(actor, organizationId, projectId);
    }

    @PostMapping
    public ResponseEntity<ProjectService.Project> create(@AuthenticationPrincipal DialogaUser actor,
            @PathVariable UUID organizationId, @RequestBody CreateProject request) {
        var project = projects.create(actor, organizationId, request.name(), request.slug(), request.description());
        return ResponseEntity.created(URI.create("/api/organizations/" + organizationId + "/projects/" + project.id())).body(project);
    }

    // Il payload espone soltanto i metadati modificabili: tenant, slug e stato
    // restano sotto il controllo del server.
    @PutMapping("/{projectId}")
    public ProjectService.Project update(@AuthenticationPrincipal DialogaUser actor,
            @PathVariable UUID organizationId, @PathVariable UUID projectId, @RequestBody UpdateProject request) {
        return projects.update(actor, organizationId, projectId, request.name(), request.description());
    }

    @PostMapping("/{projectId}/archive")
    public ResponseEntity<Void> archive(@AuthenticationPrincipal DialogaUser actor,
            @PathVariable UUID organizationId, @PathVariable UUID projectId) {
        projects.archive(actor, organizationId, projectId);
        return ResponseEntity.noContent().build();
    }

    public record UpdateProject(String name, String description) { }
    public record CreateProject(String name, String slug, String description) { }
}
