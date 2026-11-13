// Linux-only measurement shim. Does not print SQL, bindings, payloads, IDs, or tokens.
#define _GNU_SOURCE
#include <dlfcn.h>
#include <sqlite3.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <time.h>

static uint64_t statements, rows, grant_rows, command_rows, registration_rows, blob_bytes, vm_steps;
static uint64_t writer_count, writer_sum, writer_max, writer_begin_wait, writer_started;
static sqlite3 *writer_db;
static uint64_t now_ns(void) {
    struct timespec t; clock_gettime(CLOCK_MONOTONIC, &t);
    return (uint64_t)t.tv_sec * 1000000000ULL + t.tv_nsec;
}
void itoma_probe_reset(void) {
    statements = rows = grant_rows = command_rows = registration_rows = blob_bytes = vm_steps = 0;
    writer_count = writer_sum = writer_max = writer_begin_wait = writer_started = 0;
    writer_db = NULL;
}
const char *itoma_probe_snapshot(void) {
    static char report[1024];
    snprintf(report, sizeof(report),
        "{\"statements\":%llu,\"rows\":%llu,\"grant_payload_rows\":%llu,"
        "\"command_payload_rows\":%llu,\"registration_payload_rows\":%llu,"
        "\"blob_bytes\":%llu,\"vm_steps\":%llu,\"writer_count\":%llu,\"writer_total_ms\":%.6f,"
        "\"writer_max_ms\":%.6f,\"writer_begin_wait_ms\":%.6f}",
        (unsigned long long)statements, (unsigned long long)rows,
        (unsigned long long)grant_rows, (unsigned long long)command_rows,
        (unsigned long long)registration_rows, (unsigned long long)blob_bytes, (unsigned long long)vm_steps,
        (unsigned long long)writer_count, writer_sum / 1e6, writer_max / 1e6, writer_begin_wait / 1e6);
    return report;
}
int sqlite3_finalize(sqlite3_stmt *stmt) {
    static int (*real_finalize)(sqlite3_stmt *);
    if (!real_finalize) real_finalize = dlsym(RTLD_NEXT, "sqlite3_finalize");
    if (stmt) vm_steps += sqlite3_stmt_status(stmt, SQLITE_STMTSTATUS_VM_STEP, 0);
    return real_finalize(stmt);
}
int sqlite3_prepare_v2(sqlite3 *db, const char *sql, int size, sqlite3_stmt **stmt, const char **tail) {
    static int (*real_prepare)(sqlite3 *, const char *, int, sqlite3_stmt **, const char **);
    if (!real_prepare) real_prepare = dlsym(RTLD_NEXT, "sqlite3_prepare_v2");
    statements++;
    return real_prepare(db, sql, size, stmt, tail);
}
int sqlite3_step(sqlite3_stmt *stmt) {
    static int (*real_step)(sqlite3_stmt *);
    if (!real_step) real_step = dlsym(RTLD_NEXT, "sqlite3_step");
    const char *sql = sqlite3_sql(stmt);
    int begin = sql && !strcmp(sql, "BEGIN IMMEDIATE");
    uint64_t started = begin ? now_ns() : 0;
    int result = real_step(stmt);
    if (begin) writer_begin_wait += now_ns() - started;
    if (begin && result == SQLITE_DONE) {
        writer_started = now_ns(); writer_db = sqlite3_db_handle(stmt);
        writer_count++;
    }
    if (result == SQLITE_DONE && writer_started && writer_db == sqlite3_db_handle(stmt)
        && sql && (!strcmp(sql, "COMMIT") || !strcmp(sql, "ROLLBACK"))) {
        uint64_t held = now_ns() - writer_started;
        writer_sum += held; if (held > writer_max) writer_max = held;
        writer_started = 0; writer_db = NULL;
    }
    if (result == SQLITE_ROW) {
        rows++;
        const char *from = sql ? strstr(sql, "FROM ") : NULL;
        const char *record = sql ? strstr(sql, "record") : NULL;
        // A JSON predicate over record with SELECT grant_id is not a returned payload.
        if (record && from && record < from) {
            if (strstr(sql, "FROM grants")) grant_rows++;
            if (strstr(sql, "FROM commands")) command_rows++;
            if (strstr(sql, "FROM registrations")) registration_rows++;
        }
    }
    return result;
}
const void *sqlite3_column_blob(sqlite3_stmt *stmt, int column) {
    static const void *(*real_blob)(sqlite3_stmt *, int);
    if (!real_blob) real_blob = dlsym(RTLD_NEXT, "sqlite3_column_blob");
    blob_bytes += sqlite3_column_bytes(stmt, column);
    return real_blob(stmt, column);
}
