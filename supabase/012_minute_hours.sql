-- =====================================================================
-- Key Club — update 012: hours to the minute
--
-- Hours were numeric(4,1): one decimal place, so 40 minutes could only
-- be stored as 0.7 hrs (42 min). Officers now type hours and minutes,
-- and the app saves minutes / 60. Four decimal places keep that exact
-- to well under a second: 40 min = 0.6667, and even a year of 40-minute
-- entries sums to within a minute of the true total.
--
-- Postgres won't change a column's type while a view reads it, so this
-- saves every view that depends on the two columns (and views on those
-- views), drops them, widens the columns, and puts the views back with
-- the same definition, options and grants.
--
-- Run after 011. Safe to re-run.
-- =====================================================================

do $$
declare
  v record;
  saved jsonb := '[]'::jsonb;
  i int;
  g record;
begin
  -- Every view that reads posts or hours_log, directly or through another
  -- view. Ordered so each view comes after the views it reads.
  for v in
    with recursive deps(oid, depth) as (
      select distinct r.ev_class, 1
        from pg_depend d
        join pg_rewrite r on r.oid = d.objid
       where d.refobjid in ('public.hours_log'::regclass, 'public.posts'::regclass)
         and r.ev_class not in ('public.hours_log'::regclass, 'public.posts'::regclass)
      union
      select distinct r.ev_class, deps.depth + 1
        from deps
        join pg_depend d on d.refobjid = deps.oid
        join pg_rewrite r on r.oid = d.objid
       where r.ev_class <> deps.oid
    )
    select c.oid,
           n.nspname as schema,
           c.relname as name,
           pg_get_viewdef(c.oid) as def,
           c.reloptions as opts,
           max(deps.depth) as depth
      from deps
      join pg_class c on c.oid = deps.oid and c.relkind = 'v'
      join pg_namespace n on n.oid = c.relnamespace
     group by c.oid, n.nspname, c.relname, c.reloptions
     order by max(deps.depth)
  loop
    saved := saved || jsonb_build_object(
      'schema', v.schema,
      'name',   v.name,
      'def',    v.def,
      'opts',   coalesce(array_to_string(v.opts, ', '), ''),
      'grants', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'priv', a.privilege_type,
                 'role', case when a.grantee = 0 then 'public'
                              else quote_ident(pg_get_userbyid(a.grantee)) end))
          from pg_class c2, aclexplode(c2.relacl) a
         where c2.oid = v.oid
           and a.grantee <> c2.relowner
      ), '[]'::jsonb)
    );
  end loop;

  -- Drop deepest first.
  for i in reverse jsonb_array_length(saved) - 1 .. 0 loop
    execute format('drop view if exists %I.%I',
                   saved->i->>'schema', saved->i->>'name');
  end loop;

  alter table public.hours_log alter column hours         type numeric(6,4);
  alter table public.posts     alter column service_hours type numeric(6,4);

  -- Recreate shallowest first.
  for i in 0 .. jsonb_array_length(saved) - 1 loop
    execute format('create view %I.%I %s as %s',
                   saved->i->>'schema', saved->i->>'name',
                   case when saved->i->>'opts' = '' then ''
                        else 'with (' || (saved->i->>'opts') || ')' end,
                   saved->i->>'def');
    for g in select * from jsonb_to_recordset(saved->i->'grants') as x(priv text, role text) loop
      execute format('grant %s on %I.%I to %s',
                     g.priv, saved->i->>'schema', saved->i->>'name', g.role);
    end loop;
  end loop;
end
$$;
