# Procedures, reports and document output

[Official capability comparison](https://prioritysoftware.github.io/general) distinguishes REST record operations from Web SDK procedures/reports and Choose/Search triggers. REST invokes business form logic, but a status PATCH is not equivalent to a closing procedure. Generic metadata does not define business workflows.

Open the [Web SDK reference](https://prioritysoftware.github.io/api/) for the exact method needed. Navigate to Form actions (`activateStart`, `activateEnd`), Global (`login`, `formStart`, `procStart`), Procedure steps, or Printing an Invoice. Verify signatures against installed SDK before implementation.

Implementation workflow:

1. Reuse the project's authenticated SDK client and company configuration.
2. Open the target form; retrieve the intended row by verified business key and activate it.
3. Discover available activations rather than guessing procedure names. Run the selected action and handle its actual procedure steps.
4. Handle messages, errors and required input; only confirm prompts within the operation the user authorized. Unknown steps must not be treated as successful completion.
5. Use bounded timeouts and step counts; release form/action resources in cleanup. A client timeout does not imply cancellation on the server.
6. Re-read the record to confirm final state and any changed document number. For printing, require an actual returned document/link.

For the existing invoice implementation and its limitations, load [zaban.md](zaban.md). Do not generalize its activation names to another installation.
