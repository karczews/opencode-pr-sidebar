# Spec Delta

## MODIFIED Requirements

### Requirement: Clickable pull request link with open and copy actions
The system SHALL make the pull request title a terminal hyperlink, visibly styled as a link, and provide Open-in-browser and Copy-URL actions with a manual-URL fallback.

#### Scenario: Title is styled as a link
- **WHEN** the card shows a pull request
- **THEN** the pull request title is rendered underlined in the link color, and the surrounding card text, including the `#<number>` prefix, is not underlined.

#### Scenario: Open pull request in browser
- **WHEN** the user activates the title link or the Open action and a local browser launcher exists
- **THEN** the system launches the pull request URL in the browser.

#### Scenario: Fallback when browser cannot launch
- **WHEN** the user activates Open over SSH, on a headless machine, on an unsupported platform, or when the launcher is missing or fails
- **THEN** the system shows the full pull request URL for manual opening instead of failing silently.

#### Scenario: Copy pull request URL
- **WHEN** the user activates the Copy action
- **THEN** the system copies the full pull request URL to the clipboard or reports that copying failed.
