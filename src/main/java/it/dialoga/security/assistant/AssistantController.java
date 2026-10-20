package it.dialoga.security.assistant;

import it.dialoga.security.DialogaUser;
import java.net.URI;
import java.util.UUID;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

/** Tenant e progetto sono sempre fissati dal percorso, mai dai dati del modulo. */
@RestController
@RequestMapping("/api/organizations/{organizationId}/projects/{projectId}/assistants")
public class AssistantController {
    private final AssistantService assistants;
    public AssistantController(AssistantService assistants) { this.assistants = assistants; }

    @GetMapping
    public ResponseEntity<AssistantService.Listing> list(@AuthenticationPrincipal DialogaUser actor,
            @PathVariable UUID organizationId, @PathVariable UUID projectId) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(assistants.list(actor, organizationId, projectId));
    }
    @GetMapping("/{assistantId}")
    public ResponseEntity<AssistantService.Details> get(@AuthenticationPrincipal DialogaUser actor,
            @PathVariable UUID organizationId, @PathVariable UUID projectId, @PathVariable UUID assistantId) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(assistants.get(actor, organizationId, projectId, assistantId));
    }
    @PostMapping
    public ResponseEntity<AssistantService.Details> create(@AuthenticationPrincipal DialogaUser actor,
            @PathVariable UUID organizationId, @PathVariable UUID projectId, @RequestBody CreateAssistant request) {
        var assistant = assistants.create(actor, organizationId, projectId, request.name(), request.instructions(), request.welcomeMessage());
        return ResponseEntity.created(URI.create("/api/organizations/" + organizationId + "/projects/" + projectId + "/assistants/" + assistant.id()))
                .cacheControl(CacheControl.noStore()).body(assistant);
    }
    @PutMapping("/{assistantId}")
    public ResponseEntity<AssistantService.Details> update(@AuthenticationPrincipal DialogaUser actor,
            @PathVariable UUID organizationId, @PathVariable UUID projectId, @PathVariable UUID assistantId, @RequestBody UpdateAssistant request) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(assistants.update(actor, organizationId, projectId, assistantId,
                request.name(), request.instructions(), request.welcomeMessage(), request.expectedVersion()));
    }
    public record CreateAssistant(String name, String instructions, String welcomeMessage) { }
    public record UpdateAssistant(String name, String instructions, String welcomeMessage, Long expectedVersion) { }
}
