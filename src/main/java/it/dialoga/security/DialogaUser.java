package it.dialoga.security;

import java.util.UUID;

public record DialogaUser(UUID id, String email, String firstName, String lastName) { }
