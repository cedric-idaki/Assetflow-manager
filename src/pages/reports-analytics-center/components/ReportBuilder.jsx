/**
 * REPORT BUILDER — pick a source, pick columns, filter, group, run, keep.
 *
 * The screen is deliberately in the order the question gets asked: what am I
 * reporting on, which columns, over what period, narrowed how, summarised how.
 * Every control writes into one `definition` object, which is the same object
 * that gets saved, so what you built and what gets stored can never drift.
 *
 * Nothing here decides what may be read. The catalogue decides what is offered
 * (src/config/reportSchema.js), the engine decides what query that becomes
 * (src/utils/reportQuery.js), and RLS decides what comes back.
 */

import React, { useState, useMemo, useCallback, useEffect } from 'react';
import Icon from '../../../components/AppIcon';
import { useModules } from '../../../contexts/TenantModulesContext';
import { useReportBuilder, PREVIEW_ROWS } from '../../../hooks/useReportBuilder';
import { downloadCSV } from '../../../utils/exportUtils';
import {
  sourcesFor, sourceByKey, fieldByKey,
  operatorsForType, aggregationsForType, PERIOD_PRESETS, DATE_GRANULARITIES,
  isNumericType, isTemporalType,
} from '../../../config/reportSchema';
import {
  emptyDefinition, validateDefinition, formatCell, cellLabel, toExportRows,
} from '../../../utils/reportQuery';

// ─── SMALL PRESENTATIONAL PIECES ─────────────────────────────────────────────
const Panel = ({ title, hint, right, children }) => (
  <div className="bg-card border border-border rounded-xl">
    <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-border">
      <div>
        <h4 className="text-sm font-semibold text-foreground">{title}</h4>
        {hint && <p className="text-xs text-muted-foreground mt-0.5">{hint}</p>}
      </div>
      {right}
    </div>
    <div className="p-4">{children}</div>
  </div>
);

const selectClass =
  'bg-background border border-border rounded-lg px-2.5 py-1.5 text-sm text-foreground ' +
  'focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50';

const inputClass = selectClass;

const Ghost = ({ onClick, icon, children, tone = 'muted', type = 'button', disabled }) => (
  <button
    type={type}
    onClick={onClick}
    disabled={disabled}
    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
      tone === 'danger'
        ? 'border-red-200 dark:border-red-900 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40'
        : 'border-border text-muted-foreground hover:text-foreground hover:bg-muted'
    }`}
  >
    {icon && <Icon name={icon} size={13} color="currentColor" />}
    {children}
  </button>
);

const Note = ({ tone = 'amber', icon = 'AlertTriangle', children }) => {
  const tones = {
    amber: 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900 text-amber-800 dark:text-amber-200',
    red:   'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-900 text-red-700 dark:text-red-200',
    blue:  'bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-900 text-blue-800 dark:text-blue-200',
  };
  return (
    <div className={`flex items-start gap-2 px-3 py-2 rounded-lg border text-xs ${tones[tone]}`}>
      <Icon name={icon} size={14} color="currentColor" className="mt-px shrink-0" />
      <div className="space-y-0.5">{children}</div>
    </div>
  );
};

// ─── ONE FILTER ROW ──────────────────────────────────────────────────────────
/**
 * The box a filter value is typed into.
 *
 * Defined at module scope, NOT inside FilterRow. A component declared inside
 * another render is a new component type on every render, so React unmounts and
 * remounts it rather than updating it — the input loses focus after the first
 * character and the filter ends up holding "1" instead of "1000". It looks like
 * a typing bug and is a reconciliation one.
 */
const ValueBox = ({ index, type, filter, onSet }) => (
  <input
    type={type}
    value={filter.values?.[index] ?? ''}
    onChange={(e) => onSet(index, e.target.value)}
    placeholder="value"
    aria-label={index === 0 ? 'Filter value' : 'Filter upper value'}
    className={`${inputClass} min-w-[8rem] flex-1`}
  />
);

/**
 * The value input follows the operator's arity, not the field's type alone.
 * A `between` needs two boxes and a `is blank` needs none, and rendering one
 * box for all three is how a half-specified filter gets built in the first
 * place — the engine then drops it and the user never learns why.
 */
const FilterRow = ({ source, filter, onChange, onRemove }) => {
  const field = fieldByKey(source, filter.field);
  const operators = field ? operatorsForType(field.type) : [];
  const op = operators.find((o) => o.value === filter.operator) || operators[0];

  const filterable = (source.fields || []).filter((f) => !f.join && f.filterable !== false);

  const setValue = (index, value) => {
    const values = [...(filter.values || [])];
    values[index] = value;
    onChange({ ...filter, values });
  };

  const inputType =
    field?.type === 'month' ? 'month'
      : isTemporalType(field?.type) ? 'date'
        : isNumericType(field?.type) ? 'number'
          : 'text';

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        value={filter.field}
        onChange={(e) => {
          const next = fieldByKey(source, e.target.value);
          const nextOps = operatorsForType(next?.type);
          // The operator has to be re-picked with the field: "contains" is
          // meaningless on a number and would just be dropped silently.
          onChange({ field: e.target.value, operator: nextOps[0]?.value, values: [] });
        }}
        aria-label="Filter column"
        className={`${selectClass} min-w-[9rem]`}
      >
        {filterable.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
      </select>

      <select
        value={op?.value || ''}
        onChange={(e) => onChange({ ...filter, operator: e.target.value, values: [] })}
        aria-label="Filter condition"
        className={`${selectClass} min-w-[8rem]`}
      >
        {operators.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>

      {op?.arity === 1 && (
        field?.options
          ? (
            <select
              value={filter.values?.[0] ?? ''}
              onChange={(e) => setValue(0, e.target.value)}
              aria-label="Filter value"
              className={`${selectClass} min-w-[9rem] flex-1`}
            >
              <option value="">Choose…</option>
              {field.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          )
          : <ValueBox index={0} type={inputType} filter={filter} onSet={setValue} />
      )}

      {op?.arity === 2 && (
        <>
          <ValueBox index={0} type={inputType} filter={filter} onSet={setValue} />
          <span className="text-xs text-muted-foreground">and</span>
          <ValueBox index={1} type={inputType} filter={filter} onSet={setValue} />
        </>
      )}

      {op?.arity === 'list' && (
        field?.options
          ? (
            <div className="flex flex-wrap gap-1.5 flex-1">
              {field.options.map((o) => {
                const on = (filter.values || []).includes(o.value);
                return (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => onChange({
                      ...filter,
                      values: on
                        ? filter.values.filter((v) => v !== o.value)
                        : [...(filter.values || []), o.value],
                    })}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${
                      on ? 'border-primary/40 text-primary bg-primary/10'
                         : 'border-border text-muted-foreground hover:text-foreground hover:bg-muted'
                    }`}
                  >
                    {o.label}
                  </button>
                );
              })}
            </div>
          )
          : (
            <input
              type="text"
              value={(filter.values || []).join(', ')}
              onChange={(e) => onChange({
                ...filter,
                values: e.target.value.split(',').map((v) => v.trim()).filter(Boolean),
              })}
              placeholder="comma, separated, values"
              className={`${inputClass} flex-1 min-w-[10rem]`}
            />
          )
      )}

      <button
        type="button"
        onClick={onRemove}
        title="Remove this filter"
        className="p-1.5 rounded-lg text-muted-foreground hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors"
      >
        <Icon name="X" size={14} color="currentColor" />
      </button>
    </div>
  );
};

// ─── SAVE DIALOG ─────────────────────────────────────────────────────────────
const SaveDialog = ({ initial, onCancel, onSave, saving }) => {
  const [name, setName] = useState(initial?.name || '');
  const [description, setDescription] = useState(initial?.description || '');
  const [isShared, setIsShared] = useState(Boolean(initial?.is_shared));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={initial?.id ? 'Update this report' : 'Save this report'}
        className="bg-card border border-border rounded-2xl w-full max-w-md shadow-xl"
      >
        <div className="px-5 py-4 border-b border-border">
          <h3 className="text-base font-semibold text-foreground">
            {initial?.id ? 'Update this report' : 'Save this report'}
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            The question is saved, not the figures — it re-runs against fresh data every time.
          </p>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="text-xs font-semibold text-muted-foreground block mb-1.5">Name</label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
              placeholder="Monthly collections by method"
              className={`${inputClass} w-full`}
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-muted-foreground block mb-1.5">
              What it answers <span className="font-normal">(optional)</span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className={`${inputClass} w-full resize-none`}
            />
          </div>

          <label className="flex items-start gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={isShared}
              onChange={(e) => setIsShared(e.target.checked)}
              className="mt-0.5"
            />
            <span className="text-xs text-muted-foreground">
              <span className="font-semibold text-foreground block">Share with the team</span>
              Anyone here can run it. They still see only the rows their own access allows.
            </span>
          </label>
        </div>

        <div className="flex justify-end gap-2 px-5 py-4 border-t border-border">
          <Ghost onClick={onCancel}>Cancel</Ghost>
          <button
            type="button"
            disabled={saving || !name.trim()}
            onClick={() => onSave({ name, description, isShared })}
            className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-primary text-white disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving…' : 'Save this report'}
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── THE BUILDER ─────────────────────────────────────────────────────────────
const ReportBuilder = () => {
  const { isEnabled } = useModules();
  const {
    role, canBuild, savedReports, loadingSaved,
    saveReport, deleteReport, setShared,
    run, clear, result, running, runError, rowCeiling,
  } = useReportBuilder();

  const sources = useMemo(
    () => sourcesFor({ role, isModuleEnabled: isEnabled }),
    [role, isEnabled],
  );

  const [sourceKey,  setSourceKey]  = useState(null);
  const [definition, setDefinition] = useState(null);
  const [loadedFrom, setLoadedFrom] = useState(null);   // the saved row this came from
  const [showSave,   setShowSave]   = useState(false);
  const [saving,     setSaving]     = useState(false);
  const [saveError,  setSaveError]  = useState(null);

  // Start on the first source the user is actually offered. Waits for the
  // module statuses to arrive rather than defaulting to something that then
  // disappears under them.
  useEffect(() => {
    if (sourceKey || sources.length === 0) return;
    setSourceKey(sources[0].key);
    setDefinition(emptyDefinition(sources[0]));
  }, [sources, sourceKey]);

  const source = sourceKey ? sourceByKey(sourceKey) : null;

  const chooseSource = useCallback((key) => {
    const next = sourceByKey(key);
    if (!next) return;
    setSourceKey(key);
    // A definition is only meaningful against its own source — columns and
    // filters do not carry across, so this starts clean rather than half-carrying
    // a filter that names a column the new source has never had.
    setDefinition(emptyDefinition(next));
    setLoadedFrom(null);
    clear();
  }, [clear]);

  const patch = useCallback((changes) => {
    setDefinition((d) => ({ ...d, ...changes }));
  }, []);

  const toggleField = useCallback((key) => {
    setDefinition((d) => ({
      ...d,
      // Appending rather than re-sorting to the catalogue order: the order the
      // user ticks columns is the order they want to read them in, and it is
      // the order the CSV comes out in.
      fields: d.fields.includes(key) ? d.fields.filter((f) => f !== key) : [...d.fields, key],
    }));
  }, []);

  const moveField = useCallback((key, delta) => {
    setDefinition((d) => {
      const i = d.fields.indexOf(key);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= d.fields.length) return d;
      const fields = [...d.fields];
      [fields[i], fields[j]] = [fields[j], fields[i]];
      return { ...d, fields };
    });
  }, []);

  const loadSaved = useCallback((row) => {
    const src = sourceByKey(row.source_key);
    if (!src) return;
    const check = validateDefinition(row.definition, src);
    setSourceKey(src.key);
    setDefinition(check.definition || emptyDefinition(src));
    setLoadedFrom(row);
    clear();
    if (check.definition) run(check.definition, { savedId: row.id });
  }, [clear, run]);

  const onSave = useCallback(async ({ name, description, isShared }) => {
    setSaving(true);
    setSaveError(null);
    const res = await saveReport({
      id: loadedFrom?.id || null, name, description, definition, isShared,
    });
    setSaving(false);
    if (res.error) { setSaveError(res.error.message); return; }
    setLoadedFrom(res.data || null);
    setShowSave(false);
  }, [saveReport, loadedFrom, definition]);

  const exportCSV = useCallback(() => {
    if (!result) return;
    const { columns, rows } = toExportRows(result.report);
    const stamp = new Date().toISOString().slice(0, 10);
    const name = (loadedFrom?.name || `${result.source.label} report`)
      .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

    // The provenance rides along in the file. A CSV of numbers with no
    // statement of what was excluded is a CSV that gets quoted out of context
    // in a meeting nobody from this screen is in. Trailing rows rather than a
    // preamble, so the header stays on line one and the file still parses.
    const meta = [
      {},
      { [columns[0]]: `Report: ${loadedFrom?.name || result.source.label}` },
      ...result.coverage.map((line) => ({ [columns[0]]: line })),
      { [columns[0]]: `${result.report.rowCount} rows · generated ${new Date().toLocaleString('en-GB')}` },
    ];

    downloadCSV([...rows, ...meta], `${name}_${stamp}`, columns);
  }, [result, loadedFrom]);

  // ── Gates ────────────────────────────────────────────────────────────────
  if (!canBuild) {
    return (
      <Note tone="blue" icon="Lock">
        <p className="font-semibold">The report builder is not available for your role.</p>
        <p>The standard reports on this page are, and they cover the same data.</p>
      </Note>
    );
  }

  if (sources.length === 0) {
    return (
      <Note tone="blue" icon="PackageX">
        <p className="font-semibold">No modules are switched on that hold reportable data.</p>
        <p>Switch a module back on under Modules and its data becomes reportable again — nothing was deleted.</p>
      </Note>
    );
  }

  if (!source || !definition) return null;

  const check = validateDefinition(definition, source);
  const chosen = definition.fields;
  const groupField = definition.groupBy ? fieldByKey(source, definition.groupBy.field) : null;
  const numericFields = source.fields.filter((f) => isNumericType(f.type));
  const previewRows = result ? result.report.rows.slice(0, PREVIEW_ROWS) : [];

  return (
    <div className="space-y-4">
      {/* ── Saved shelf ───────────────────────────────────────────────────── */}
      {(savedReports.length > 0 || loadingSaved) && (
        <Panel
          title="Saved reports"
          hint="Saved questions, re-run against today's data"
        >
          {loadingSaved ? (
            <div className="h-8 bg-muted rounded-lg animate-pulse" />
          ) : (
            <div className="flex flex-wrap gap-2">
              {savedReports.map((row) => {
                const active = loadedFrom?.id === row.id;
                const src = sourceByKey(row.source_key);
                return (
                  <div
                    key={row.id}
                    className={`flex items-center gap-1 rounded-xl border transition-colors ${
                      active ? 'border-primary/40 bg-primary/8' : 'border-border hover:bg-muted'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => loadSaved(row)}
                      className="flex items-center gap-2 pl-3 pr-2 py-2 text-left"
                      title={row.description || src?.label || row.source_key}
                    >
                      <Icon name={src?.icon || 'FileText'} size={13} color="currentColor"
                            className={active ? 'text-primary' : 'text-muted-foreground'} />
                      <span className={`text-sm font-medium ${active ? 'text-primary' : 'text-foreground'}`}>
                        {row.name}
                      </span>
                      {row.is_shared && (
                        <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground border border-border rounded px-1 py-px">
                          Shared
                        </span>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShared(row.id, !row.is_shared)}
                      title={row.is_shared ? 'Stop sharing with the team' : 'Share with the team'}
                      className="p-1.5 text-muted-foreground hover:text-foreground"
                    >
                      <Icon name={row.is_shared ? 'Users' : 'UserPlus'} size={13} color="currentColor" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm(`Delete the saved report "${row.name}"? The data it reports on is untouched.`)) {
                          deleteReport(row.id);
                          if (loadedFrom?.id === row.id) setLoadedFrom(null);
                        }
                      }}
                      title="Delete this saved report"
                      className="p-1.5 pr-2.5 text-muted-foreground hover:text-red-600"
                    >
                      <Icon name="Trash2" size={13} color="currentColor" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </Panel>
      )}

      {/* ── 1. Source ─────────────────────────────────────────────────────── */}
      <Panel title="1 · What are you reporting on?" hint="One source per report">
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-2">
          {sources.map((s) => {
            const active = s.key === sourceKey;
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => chooseSource(s.key)}
                className={`text-left p-3 rounded-xl border transition-all ${
                  active ? 'border-primary/40 bg-primary/8' : 'border-border hover:bg-muted'
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <Icon name={s.icon} size={14} color="currentColor"
                        className={active ? 'text-primary' : 'text-muted-foreground'} />
                  <span className={`text-sm font-semibold ${active ? 'text-primary' : 'text-foreground'}`}>
                    {s.label}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground leading-snug">{s.description}</p>
              </button>
            );
          })}
        </div>
      </Panel>

      {/* ── 2. Columns ────────────────────────────────────────────────────── */}
      <Panel
        title="2 · Which columns?"
        hint={chosen.length ? `${chosen.length} chosen — they appear in the order you pick them` : 'Pick at least one'}
        right={
          <div className="flex gap-2">
            <Ghost onClick={() => patch({ fields: source.defaultFields.slice() })} icon="RotateCcw">Suggested</Ghost>
            <Ghost onClick={() => patch({ fields: [] })} icon="Eraser">Clear</Ghost>
          </div>
        }
      >
        <div className="flex flex-wrap gap-1.5">
          {source.fields.map((f) => {
            const on = chosen.includes(f.key);
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => toggleField(f.key)}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                  on ? 'border-primary/40 text-primary bg-primary/10'
                     : 'border-border text-muted-foreground hover:text-foreground hover:bg-muted'
                }`}
              >
                {f.label}
              </button>
            );
          })}
        </div>

        {chosen.length > 0 && (
          <div className="mt-3 pt-3 border-t border-border flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-muted-foreground mr-1">Order:</span>
            {chosen.map((key, i) => (
              <span key={key} className="inline-flex items-center gap-0.5 bg-muted rounded-lg pl-2 pr-0.5 py-0.5">
                <span className="text-xs text-foreground">{fieldByKey(source, key)?.label || key}</span>
                <button type="button" onClick={() => moveField(key, -1)} disabled={i === 0}
                        className="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-25">
                  <Icon name="ChevronLeft" size={12} color="currentColor" />
                </button>
                <button type="button" onClick={() => moveField(key, 1)} disabled={i === chosen.length - 1}
                        className="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-25">
                  <Icon name="ChevronRight" size={12} color="currentColor" />
                </button>
              </span>
            ))}
          </div>
        )}
      </Panel>

      {/* ── 3. Period + filters ───────────────────────────────────────────── */}
      <Panel
        title="3 · Narrow it down"
        hint={source.dateField
          ? 'The period re-resolves every time the report runs, so a saved report never goes stale'
          : `${source.label} has no date to report a period on`}
        right={
          <Ghost
            icon="Plus"
            onClick={() => {
              const first = source.fields.find((f) => !f.join && f.filterable !== false);
              if (!first) return;
              patch({
                filters: [...definition.filters, {
                  field: first.key,
                  operator: operatorsForType(first.type)[0]?.value,
                  values: [],
                }],
              });
            }}
          >
            Add filter
          </Ghost>
        }
      >
        {source.dateField && (
          <div className="flex flex-wrap items-end gap-2 mb-3">
            <div>
              <label className="text-xs font-semibold text-muted-foreground block mb-1.5">Period</label>
              <select
                value={definition.period.preset}
                onChange={(e) => patch({ period: { ...definition.period, preset: e.target.value } })}
                aria-label="Reporting period"
                className={selectClass}
              >
                {PERIOD_PRESETS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </div>

            {definition.period.preset === 'custom' && (
              <>
                <div>
                  <label className="text-xs font-semibold text-muted-foreground block mb-1.5">From</label>
                  <input type="date" value={definition.period.from || ''}
                         onChange={(e) => patch({ period: { ...definition.period, from: e.target.value } })}
                         className={inputClass} />
                </div>
                <div>
                  <label className="text-xs font-semibold text-muted-foreground block mb-1.5">To</label>
                  <input type="date" value={definition.period.to || ''}
                         onChange={(e) => patch({ period: { ...definition.period, to: e.target.value } })}
                         className={inputClass} />
                </div>
              </>
            )}

            <p className="text-xs text-muted-foreground pb-2">
              on {fieldByKey(source, source.dateField)?.label
                  || source.fields.find((f) => f.column === source.dateField)?.label
                  || source.dateField}
            </p>
          </div>
        )}

        {definition.filters.length === 0 ? (
          <p className="text-xs text-muted-foreground">No filters — every row in the period.</p>
        ) : (
          <div className="space-y-2">
            {definition.filters.map((f, i) => (
              <FilterRow
                key={i}
                source={source}
                filter={f}
                onChange={(next) => patch({
                  filters: definition.filters.map((x, j) => (j === i ? next : x)),
                })}
                onRemove={() => patch({ filters: definition.filters.filter((_, j) => j !== i) })}
              />
            ))}
          </div>
        )}
      </Panel>

      {/* ── 4. Summarise ──────────────────────────────────────────────────── */}
      <Panel
        title="4 · Detail or summary?"
        hint="Group the rows to get one line per category instead of one line per record"
      >
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="text-xs font-semibold text-muted-foreground block mb-1.5">Group by</label>
            <select
              value={definition.groupBy?.field || ''}
              onChange={(e) => patch({
                groupBy: e.target.value
                  ? { field: e.target.value, granularity: 'month' }
                  : null,
              })}
              aria-label="Group by"
              className={selectClass}
            >
              <option value="">Nothing — show every row</option>
              {source.fields.filter((f) => !f.join).map((f) => (
                <option key={f.key} value={f.key}>{f.label}</option>
              ))}
            </select>
          </div>

          {groupField && isTemporalType(groupField.type) && groupField.type !== 'month' && (
            <div>
              <label className="text-xs font-semibold text-muted-foreground block mb-1.5">Bucket</label>
              <select
                value={definition.groupBy.granularity || 'month'}
                onChange={(e) => patch({ groupBy: { ...definition.groupBy, granularity: e.target.value } })}
                aria-label="Date bucket"
                className={selectClass}
              >
                {DATE_GRANULARITIES.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
              </select>
            </div>
          )}

          {definition.groupBy && (
            <Ghost
              icon="Plus"
              onClick={() => {
                const f = numericFields[0] || source.fields[0];
                patch({
                  aggregates: [...definition.aggregates, {
                    field: f.key,
                    fn: isNumericType(f.type) ? 'sum' : 'count',
                  }],
                });
              }}
            >
              Add a figure
            </Ghost>
          )}
        </div>

        {definition.groupBy && definition.aggregates.length > 0 && (
          <div className="mt-3 space-y-2">
            {definition.aggregates.map((a, i) => {
              const f = fieldByKey(source, a.field);
              return (
                <div key={i} className="flex flex-wrap items-center gap-2">
                  <select
                    value={a.fn}
                    onChange={(e) => patch({
                      aggregates: definition.aggregates.map((x, j) => (j === i ? { ...x, fn: e.target.value } : x)),
                    })}
                    aria-label="Figure"
                    className={selectClass}
                  >
                    {aggregationsForType(f?.type).map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                  <span className="text-xs text-muted-foreground">of</span>
                  <select
                    value={a.field}
                    onChange={(e) => {
                      const next = fieldByKey(source, e.target.value);
                      const allowed = aggregationsForType(next?.type).map((o) => o.value);
                      patch({
                        aggregates: definition.aggregates.map((x, j) => (j === i
                          ? { field: e.target.value, fn: allowed.includes(x.fn) ? x.fn : 'count' }
                          : x)),
                      });
                    }}
                    aria-label="Figure column"
                    className={selectClass}
                  >
                    {source.fields.filter((f2) => !f2.join).map((f2) => (
                      <option key={f2.key} value={f2.key}>{f2.label}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => patch({ aggregates: definition.aggregates.filter((_, j) => j !== i) })}
                    className="p-1.5 rounded-lg text-muted-foreground hover:text-red-600"
                  >
                    <Icon name="X" size={14} color="currentColor" />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {!definition.groupBy && chosen.length > 0 && (
          <div className="mt-3 pt-3 border-t border-border flex flex-wrap items-end gap-3">
            <div>
              <label className="text-xs font-semibold text-muted-foreground block mb-1.5">Sort by</label>
              <select
                value={definition.sort?.field || ''}
                onChange={(e) => patch({
                  sort: e.target.value
                    ? { field: e.target.value, direction: definition.sort?.direction || 'desc' }
                    : null,
                })}
                aria-label="Sort by"
                className={selectClass}
              >
                <option value="">Newest first</option>
                {source.fields.filter((f) => !f.join && f.sortable !== false).map((f) => (
                  <option key={f.key} value={f.key}>{f.label}</option>
                ))}
              </select>
            </div>
            {definition.sort?.field && (
              <select
                value={definition.sort.direction}
                onChange={(e) => patch({ sort: { ...definition.sort, direction: e.target.value } })}
                aria-label="Sort direction"
                className={selectClass}
              >
                <option value="desc">Highest / newest first</option>
                <option value="asc">Lowest / oldest first</option>
              </select>
            )}
          </div>
        )}
      </Panel>

      {/* ── Run ───────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={!check.ok || running}
          onClick={() => run(definition, { savedId: loadedFrom?.id || null })}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold bg-primary text-white disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Icon name={running ? 'Loader' : 'Play'} size={14} color="currentColor"
                className={running ? 'animate-spin' : ''} />
          {running ? 'Running…' : 'Run report'}
        </button>

        <Ghost icon="Save" onClick={() => { setSaveError(null); setShowSave(true); }} disabled={!check.ok}>
          {loadedFrom ? 'Update saved report' : 'Save report'}
        </Ghost>

        {loadedFrom && (
          <Ghost icon="FilePlus" onClick={() => setLoadedFrom(null)}>Save as new</Ghost>
        )}

        <Ghost icon="Download" onClick={exportCSV} disabled={!result || result.report.rowCount === 0}>
          Export CSV
        </Ghost>

        {result && (
          <span className="text-xs text-muted-foreground ml-1">
            {result.report.rowCount.toLocaleString('en-KE')} row{result.report.rowCount === 1 ? '' : 's'}
            {result.report.rowCount > PREVIEW_ROWS && ` · showing the first ${PREVIEW_ROWS}, the export has all of them`}
          </span>
        )}
      </div>

      {check.errors.length > 0 && (
        <Note tone="amber">
          {check.errors.map((e, i) => <p key={i}>{e}</p>)}
        </Note>
      )}

      {runError && (
        <Note tone="red" icon="XCircle">
          <p className="font-semibold">The report did not run.</p>
          <p>{runError}</p>
          {/Refusing to load more than/.test(runError) && (
            <p>
              One report reads at most {rowCeiling.toLocaleString('en-KE')} rows. The cap refuses
              rather than truncating, so a report is never a partial answer that looks complete.
            </p>
          )}
        </Note>
      )}

      {result?.dropped?.length > 0 && (
        <Note tone="amber">
          <p className="font-semibold">
            {result.dropped.length} column{result.dropped.length === 1 ? '' : 's'} could not be fetched
            and {result.dropped.length === 1 ? 'was' : 'were'} left out: {result.dropped.join(', ')}.
          </p>
          <p>Everything else in the report is complete. This usually means a pending migration.</p>
        </Note>
      )}

      {/* ── Result ────────────────────────────────────────────────────────── */}
      {result && (
        <div className="print-report-content space-y-3">
          <div className="bg-card border border-border rounded-xl px-4 py-3">
            <h3 className="text-sm font-semibold text-foreground">
              {loadedFrom?.name || `${result.source.label} report`}
            </h3>
            {result.coverage.length > 0 ? (
              <ul className="mt-1 space-y-0.5">
                {result.coverage.map((line, i) => (
                  <li key={i} className="text-xs text-muted-foreground">· {line}</li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground mt-0.5">Every row, unfiltered.</p>
            )}
            <p className="text-[11px] text-muted-foreground mt-1.5">
              {result.report.rowCount.toLocaleString('en-KE')} records ·
              {' '}generated {result.ranAt.toLocaleString('en-GB')}
            </p>
          </div>

          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-muted/40">
                    {result.report.columns.map((c) => (
                      <th key={c.key}
                          className={`px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider ${
                            c.numeric ? 'text-right' : 'text-left'
                          }`}>
                        {c.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {previewRows.length === 0 ? (
                    <tr>
                      <td colSpan={result.report.columns.length}
                          className="px-4 py-12 text-center text-sm text-muted-foreground">
                        Nothing matched. Widen the period or drop a filter.
                      </td>
                    </tr>
                  ) : previewRows.map((row) => (
                    <tr key={row.__id} className="border-t border-border hover:bg-muted/20 transition-colors">
                      {result.report.columns.map((c) => (
                        <td key={c.key}
                            className={`px-4 py-2.5 text-sm text-muted-foreground ${
                              c.numeric ? 'text-right font-mono' : 'text-left'
                            }`}>
                          {c.options ? cellLabel(row[c.key], c) : formatCell(row[c.key], c.type)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
                {result.report.totals && previewRows.length > 0 && (
                  <tfoot>
                    <tr className="border-t-2 border-border bg-muted/30">
                      {result.report.columns.map((c, i) => (
                        <td key={c.key}
                            className={`px-4 py-3 text-sm font-semibold text-foreground ${
                              c.numeric ? 'text-right font-mono' : 'text-left'
                            }`}>
                          {/* Totals are computed over EVERY matching row, not
                              over the rows on screen — see buildReport. */}
                          {c.key in result.report.totals
                            ? formatCell(result.report.totals[c.key], c.type)
                            : (i === 0 ? 'Total' : '')}
                        </td>
                      ))}
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>

          {result.report.rowCount > PREVIEW_ROWS && (
            <p className="text-xs text-muted-foreground">
              The totals above are over all {result.report.rowCount.toLocaleString('en-KE')} matching
              rows, not just the {PREVIEW_ROWS} shown.
            </p>
          )}
        </div>
      )}

      {showSave && (
        <SaveDialog
          initial={loadedFrom}
          saving={saving}
          onCancel={() => setShowSave(false)}
          onSave={onSave}
        />
      )}

      {saveError && <Note tone="red" icon="XCircle"><p>{saveError}</p></Note>}
    </div>
  );
};

export default ReportBuilder;
