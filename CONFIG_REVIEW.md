# Config Review: Fields That Could Encourage Accidental Expansion

## High Risk: Arrays Without Clear Limits

### 1. `toneRules.personality.emotionalAcknowledgment.canSay` / `cannotSay`
**Risk**: Arrays that could grow indefinitely without clear criteria
**Issue**: No documentation about when/how to add items, or maximum size
**Recommendation**: Add comment: "Fixed set - do not add without explicit review. These are the ONLY approved phrases."

### 2. `toneRules.avoidGenericAcknowledgments`
**Risk**: Could become a catch-all for any phrase someone wants to avoid
**Issue**: No clear boundary on what belongs here vs. other rules
**Recommendation**: Add comment: "Complete list - if adding, ensure it's truly generic (not context-specific)"

### 3. `reasoning.certaintyHandling.lowCertaintyMarkers` / `highCertaintyMarkers`
**Risk**: Could grow indefinitely as edge cases are discovered
**Issue**: No criteria documented for what qualifies as a marker
**Recommendation**: Add comment: "Markers must be: (1) common in teen speech, (2) unambiguous, (3) not context-dependent"

### 4. `inputClassification.*` (all arrays)
**Risk**: All classification arrays could grow without bounds
**Issues**:
- `overwhelmSignals` - Could add every variation of "I can't"
- `shrinkSignals` - Could add every way to say "smaller"
- `explanatoryPatterns` - Regex patterns could multiply
- `emotionalKeywords` - Could add every emotion word
- `assignmentKeywords` - Could add every academic term
- `directRequestPatterns` - Could add every help-seeking phrase

**Recommendation**: Add comment to each: "Fixed set - additions must be: (1) distinct from existing items, (2) commonly used, (3) reviewed for overlap"

### 5. `actionButtons.readinessIndicators`
**Risk**: Array of strings that look like documentation but might be used in code
**Issue**: Ambiguous whether this is documentation or actual logic
**Recommendation**: Either make it clearly documentation-only, or if used in code, add validation

## Medium Risk: Ambiguous "Examples" Fields

### 6. `reasoning.certaintyHandling.lowCertaintyLanguage.examples`
**Risk**: Field named "examples" suggests documentation, but might be used in code
**Issue**: Unclear if this is for reference or actual logic
**Recommendation**: 
- If documentation only: Rename to `_examples` or `_documentation`
- If used in code: Rename to `tentativePhrases` and document clearly

### 7. `rules.*.examples.do` / `rules.*.examples.dont`
**Risk**: Arrays that look like they should be expanded with more examples
**Issue**: Named "examples" but might be confused with actual rules
**Recommendation**: Add comment: "Documentation only - these examples illustrate the rule but are not exhaustive. Do not add every possible variation."

### 8. `reasoning.commonSenseConstraints.*.examples`
**Risk**: Single string in `doNot` field suggests it could become an array
**Issue**: Structure implies expansion (object with `examples` property)
**Recommendation**: Either make it clearly a single principle, or if multiple needed, document max count

## Medium Risk: Open-Ended Objects

### 9. `reasoning.proportionality.mappings`
**Risk**: Object that could grow with new input types
**Issue**: No documentation about what mappings are valid or how many should exist
**Recommendation**: Add comment: "Fixed set of 4 mappings - if adding new input type, ensure it's distinct and necessary"

### 10. `resources.*`
**Risk**: Could add unlimited external resources
**Issue**: No criteria for what resources are appropriate
**Recommendation**: Add comment: "Resources must be: (1) educational/guidance-focused, (2) age-appropriate, (3) non-commercial"

## Low Risk: But Worth Noting

### 11. `rules.prematureRegulation.avoidUnless`
**Risk**: Array that could grow with more conditions
**Issue**: Currently 3 items - could someone add a 4th?
**Recommendation**: Add comment: "Complete list of conditions - if adding, ensure it's truly an explicit signal (not inferred)"

### 12. `rules.prematureRegulation.examples.avoid`
**Risk**: Array of phrases to avoid
**Issue**: Could grow as more phrases are discovered
**Recommendation**: Add comment: "Representative examples - not exhaustive. Focus on the principle, not every variation."

## Structural Ambiguities

### 13. `reasoning.commonSenseConstraints` structure
**Issue**: Mix of boolean flags (`preferSimplest: true`) and objects with `enabled` (`noOverEscalation: { enabled: true }`)
**Risk**: Inconsistent structure could lead to confusion about how to add new constraints
**Recommendation**: Standardize - either all booleans or all objects with `enabled`

### 14. `rules.*` structure inconsistency
**Issue**: Some rules have `enabled`, `description`, `examples` - others might be added with different structures
**Risk**: New rules might be added with incomplete structure
**Recommendation**: Document required fields for a rule: `enabled`, `description`, `examples` (optional)

## Recommendations Summary

1. **Add explicit limits/comments** to all arrays explaining when/how to add items
2. **Rename or document** "examples" fields to clarify if they're documentation or logic
3. **Standardize structures** (all constraints use same pattern)
4. **Add validation comments** explaining criteria for additions
5. **Consider max counts** for arrays that should stay small
6. **Document required fields** for objects that could be extended

