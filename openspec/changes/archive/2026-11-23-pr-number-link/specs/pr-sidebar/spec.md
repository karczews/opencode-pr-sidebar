# Spec Delta

## ADDED Requirements

### Requirement: Clickable pull request number with open and copy actions
The system SHALL make the pull request number a terminal hyperlink, visibly styled as a link, and provide Open-in-browser and Copy-URL actions with a manual-URL fallback. The pull request title SHALL NOT be a link.

#### Scenario: Number is styled as a link
- **WHEN** the card shows a pull request
- **THEN** the `#<number>` prefix is rendered underlined in the link color and is a terminal hyperlink to the pull request URL, and the title is rendered in the normal text color with no underline and no hyperlink.

#### Scenario: Title is not clickable
- **WHEN** the user clicks the pull request title
- **THEN** the system does not open the pull request or take any other action.

#### Scenario: Open pull request in browser
- **WHEN** the user activates the number link or the Open action and a local browser launcher exists
- **THEN** the system launches the pull request URL in the browser.

#### Scenario: Fallback when browser cannot launch
- **WHEN** the user activates Open over SSH, on a headless machine, on an unsupported platform, or when the launcher is missing or fails
- **THEN** the system shows the full pull request URL for manual opening instead of failing silently.

#### Scenario: Copy pull request URL
- **WHEN** the user activates the Copy action
- **THEN** the system copies the full pull request URL to the clipboard or reports that copying failed.

## REMOVED Requirements

### Requirement: Clickable pull request link with open and copy actions
**Reason**: The link moves from the title to the pull request number, and the title is no longer clickable or styled as a link.
**Migration**: Click the `#<number>` prefix, the Open button, or the "PR: Open on GitHub" command to open the pull request. The open, fallback and copy behavior is unchanged under "Clickable pull request number with open and copy actions".
