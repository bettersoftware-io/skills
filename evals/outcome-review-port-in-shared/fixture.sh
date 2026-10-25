# Run by the eval harness with bash, in the empty folder the agent starts in.
# The project is made by the script every real project is made by, so it is
# always the project this revision of the starter and the kit produces.
node "$(dirname "$0")/../../scripts/create-project.mts" . --scope @acme > /dev/null
node "$(dirname "$0")/change.mts"
