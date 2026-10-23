/* DRAFT ONLY: not installed, not syntax checked, not production ready.
 * See procedure-draft.json requiredBeforeActivation before any execution.
 * Uses native e-document generation; never edits PRINTED or sends email.
 */
LINK INVOICES TO :$.PAR;
ERRMSG 501 WHERE :RETVAL <= 0;
:ZBAN_IV = 0;
:ZBAN_COUNT = 0;
SELECT COUNT(*) INTO :ZBAN_COUNT FROM INVOICES WHERE IV <> 0;
SELECT IV INTO :ZBAN_IV FROM INVOICES WHERE IV <> 0;
UNLINK INVOICES;
ERRMSG 501 WHERE :RETVAL <= 0;
ERRMSG 501 WHERE :ZBAN_COUNT <> 1 OR :ZBAN_IV <= 0;
SELECT IV FROM INVOICES
WHERE IV = :ZBAN_IV AND TYPE = 'A' AND FINAL = 'Y'
AND PRINTED = '\0' AND INTERNAL <> 'Y';
ERRMSG 502 WHERE :RETVAL <= 0;
SELECT CUSTOMERS.CUST FROM CUSTOMERS, INVOICES
WHERE INVOICES.IV = :ZBAN_IV
AND CUSTOMERS.CUST = INVOICES.CUST
AND CUSTOMERS.EDOCUMENTS = 'Y';
ERRMSG 503 WHERE :RETVAL <= 0;
:ZBAN_PATH = '';
SELECT NEWATTACH('invoice-original.pdf') INTO :ZBAN_PATH FROM DUMMY;
ERRMSG 504 WHERE :ZBAN_PATH = '';
EXECUTE WINHTML '-d', 'WWWSHOWAIV', '', '', '-v', :ZBAN_IV,
'-s', '-edoc', '-pdf', :ZBAN_PATH;
ERRMSG 504 WHERE :RETVAL <= 0;
/* Retention / repeat-download / output verification must be implemented
 * before activation. A successful WINHTML return alone is not proof
 * that the file is an original. */
SELECT SQL.TMPFILE INTO :$.ADD FROM DUMMY;
SELECT :ZBAN_PATH FROM DUMMY ASCII :$.ADD;
