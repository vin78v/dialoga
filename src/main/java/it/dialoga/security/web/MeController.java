package it.dialoga.security.web;

import it.dialoga.security.DialogaUser;
import java.util.UUID;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/me")
public class MeController {
    @GetMapping
    public MeResponse me(@AuthenticationPrincipal DialogaUser user) {
        return new MeResponse(user.id(), user.email(), user.firstName(), user.lastName());
    }

    public record MeResponse(UUID id, String email, String firstName, String lastName) { }
}
