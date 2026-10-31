import { FILE_OWNER, FILE_WRITER, type FileFormat } from '../../src/main/store-format'

/** The header a file of `format` carries, at `version` when a test needs another one. */
export function header(format: FileFormat, version: unknown = format.version): { format: Record<string, unknown>; writer: Record<string, unknown> } {
  return { format: { owner: FILE_OWNER, kind: format.kind, version }, writer: { name: FILE_WRITER.name, version: FILE_WRITER.version } }
}

/** SQL that gives a database the header of `format` at `version`, owned by `owner`. */
export function headerSql(format: FileFormat, version: number = format.version, owner: string = FILE_OWNER): string {
  return `CREATE TABLE file_header (key TEXT PRIMARY KEY, value TEXT NOT NULL);
INSERT INTO file_header VALUES ('format.owner', '${owner}'), ('format.kind', '${format.kind}'), ('writer.name', 'someone-else'), ('writer.version', '9.9.9');
PRAGMA user_version = ${version};`
}
