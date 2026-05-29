--
-- PostgreSQL database dump
--

\restrict 8Xwgdr5l8yp9z7SDjlPeumphScD108LKf6n1py3ZG8jYBLNEnj40giTnJiGVwbr

-- Dumped from database version 18.1
-- Dumped by pg_dump version 18.1

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA IF NOT EXISTS public;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.assignments (
    id integer NOT NULL,
    user_id integer NOT NULL,
    module_id integer NOT NULL,
    assigned_at timestamp without time zone,
    due_at timestamp without time zone,
    completed_at timestamp without time zone,
    version_id integer,
    tracey_tenant_id text DEFAULT '7ff12271-cb84-4354-9fb1-082900c387e8'::text NOT NULL
);

ALTER TABLE ONLY public.assignments FORCE ROW LEVEL SECURITY;


--
-- Name: assignments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.assignments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: assignments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.assignments_id_seq OWNED BY public.assignments.id;


--
-- Name: attempts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.attempts (
    id integer NOT NULL,
    user_id integer NOT NULL,
    module_id integer NOT NULL,
    score integer,
    correct integer,
    total integer,
    passed boolean,
    answers_json text,
    created_at timestamp without time zone,
    tracey_tenant_id text DEFAULT '7ff12271-cb84-4354-9fb1-082900c387e8'::text NOT NULL
);

ALTER TABLE ONLY public.attempts FORCE ROW LEVEL SECURITY;


--
-- Name: attempts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.attempts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: attempts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.attempts_id_seq OWNED BY public.attempts.id;


--
-- Name: audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_logs (
    id integer NOT NULL,
    created_at timestamp without time zone NOT NULL,
    user_id integer,
    actor_email character varying(255),
    actor_name character varying(255),
    action character varying(40) NOT NULL,
    entity_type character varying(40) NOT NULL,
    entity_id integer,
    summary character varying(500),
    details_json text,
    ip_address character varying(64),
    user_agent character varying(255),
    tracey_tenant_id text DEFAULT '7ff12271-cb84-4354-9fb1-082900c387e8'::text NOT NULL
);

ALTER TABLE ONLY public.audit_logs FORCE ROW LEVEL SECURITY;


--
-- Name: audit_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.audit_logs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: audit_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.audit_logs_id_seq OWNED BY public.audit_logs.id;


--
-- Name: choices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.choices (
    id integer NOT NULL,
    question_id integer NOT NULL,
    text text NOT NULL,
    is_correct boolean,
    "position" integer,
    tracey_tenant_id text DEFAULT '7ff12271-cb84-4354-9fb1-082900c387e8'::text NOT NULL
);

ALTER TABLE ONLY public.choices FORCE ROW LEVEL SECURITY;


--
-- Name: choices_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.choices_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: choices_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.choices_id_seq OWNED BY public.choices.id;


--
-- Name: content_item_media; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.content_item_media (
    id integer NOT NULL,
    content_item_id integer NOT NULL,
    file_path character varying(500) NOT NULL,
    kind character varying(20),
    "position" integer,
    tracey_tenant_id text DEFAULT '7ff12271-cb84-4354-9fb1-082900c387e8'::text NOT NULL
);

ALTER TABLE ONLY public.content_item_media FORCE ROW LEVEL SECURITY;


--
-- Name: content_item_media_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.content_item_media_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: content_item_media_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.content_item_media_id_seq OWNED BY public.content_item_media.id;


--
-- Name: content_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.content_items (
    id integer NOT NULL,
    module_id integer NOT NULL,
    kind character varying(20) NOT NULL,
    title character varying(255) NOT NULL,
    body text,
    file_path character varying(500),
    "position" integer,
    tracey_tenant_id text DEFAULT '7ff12271-cb84-4354-9fb1-082900c387e8'::text NOT NULL
);

ALTER TABLE ONLY public.content_items FORCE ROW LEVEL SECURITY;


--
-- Name: content_items_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.content_items_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: content_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.content_items_id_seq OWNED BY public.content_items.id;


--
-- Name: department_module_policies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.department_module_policies (
    id integer NOT NULL,
    department_id integer NOT NULL,
    module_id integer NOT NULL,
    created_at timestamp without time zone,
    tracey_tenant_id text DEFAULT '7ff12271-cb84-4354-9fb1-082900c387e8'::text NOT NULL
);

ALTER TABLE ONLY public.department_module_policies FORCE ROW LEVEL SECURITY;


--
-- Name: department_module_policies_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.department_module_policies_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: department_module_policies_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.department_module_policies_id_seq OWNED BY public.department_module_policies.id;


--
-- Name: departments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.departments (
    id integer NOT NULL,
    name character varying(100) NOT NULL,
    tracey_tenant_id text DEFAULT '7ff12271-cb84-4354-9fb1-082900c387e8'::text NOT NULL
);

ALTER TABLE ONLY public.departments FORCE ROW LEVEL SECURITY;


--
-- Name: departments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.departments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: departments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.departments_id_seq OWNED BY public.departments.id;


--
-- Name: employers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employers (
    id integer NOT NULL,
    name character varying(100) NOT NULL,
    tracey_tenant_id text DEFAULT '7ff12271-cb84-4354-9fb1-082900c387e8'::text NOT NULL
);

ALTER TABLE ONLY public.employers FORCE ROW LEVEL SECURITY;


--
-- Name: employers_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.employers_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: employers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.employers_id_seq OWNED BY public.employers.id;


--
-- Name: machine_modules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.machine_modules (
    machine_id integer NOT NULL,
    module_id integer NOT NULL,
    tracey_tenant_id text DEFAULT '7ff12271-cb84-4354-9fb1-082900c387e8'::text NOT NULL
);

ALTER TABLE ONLY public.machine_modules FORCE ROW LEVEL SECURITY;


--
-- Name: machines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.machines (
    id integer NOT NULL,
    name character varying(100) NOT NULL,
    department_id integer,
    tracey_tenant_id text DEFAULT '7ff12271-cb84-4354-9fb1-082900c387e8'::text NOT NULL
);

ALTER TABLE ONLY public.machines FORCE ROW LEVEL SECURITY;


--
-- Name: machines_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.machines_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: machines_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.machines_id_seq OWNED BY public.machines.id;


--
-- Name: module_media; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.module_media (
    id integer NOT NULL,
    module_id integer NOT NULL,
    file_path character varying(500) NOT NULL,
    kind character varying(20),
    "position" integer,
    tracey_tenant_id text DEFAULT '7ff12271-cb84-4354-9fb1-082900c387e8'::text NOT NULL
);

ALTER TABLE ONLY public.module_media FORCE ROW LEVEL SECURITY;


--
-- Name: module_media_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.module_media_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: module_media_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.module_media_id_seq OWNED BY public.module_media.id;


--
-- Name: module_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.module_versions (
    id integer NOT NULL,
    module_id integer NOT NULL,
    version_number integer NOT NULL,
    snapshot_json text NOT NULL,
    created_by_id integer,
    created_at timestamp without time zone,
    summary character varying(255),
    tracey_tenant_id text DEFAULT '7ff12271-cb84-4354-9fb1-082900c387e8'::text NOT NULL
);

ALTER TABLE ONLY public.module_versions FORCE ROW LEVEL SECURITY;


--
-- Name: module_versions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.module_versions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: module_versions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.module_versions_id_seq OWNED BY public.module_versions.id;


--
-- Name: modules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.modules (
    id integer NOT NULL,
    title character varying(255) NOT NULL,
    description text,
    created_at timestamp without time zone,
    is_published boolean,
    created_by_id integer,
    cover_path character varying(500),
    valid_for_days integer,
    tracey_tenant_id text DEFAULT '7ff12271-cb84-4354-9fb1-082900c387e8'::text NOT NULL
);

ALTER TABLE ONLY public.modules FORCE ROW LEVEL SECURITY;


--
-- Name: modules_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.modules_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: modules_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.modules_id_seq OWNED BY public.modules.id;


--
-- Name: positions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.positions (
    id integer NOT NULL,
    name character varying(120) NOT NULL,
    parent_id integer,
    department_id integer,
    sort_order integer,
    created_at timestamp without time zone,
    tracey_tenant_id text DEFAULT '7ff12271-cb84-4354-9fb1-082900c387e8'::text NOT NULL
);

ALTER TABLE ONLY public.positions FORCE ROW LEVEL SECURITY;


--
-- Name: positions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.positions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: positions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.positions_id_seq OWNED BY public.positions.id;


--
-- Name: questions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.questions (
    id integer NOT NULL,
    module_id integer NOT NULL,
    prompt text NOT NULL,
    kind character varying(20),
    "position" integer,
    tracey_tenant_id text DEFAULT '7ff12271-cb84-4354-9fb1-082900c387e8'::text NOT NULL
);

ALTER TABLE ONLY public.questions FORCE ROW LEVEL SECURITY;


--
-- Name: questions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.questions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: questions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.questions_id_seq OWNED BY public.questions.id;


--
-- Name: uploaded_files; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.uploaded_files (
    filename character varying(500) NOT NULL,
    mime_type character varying(120) NOT NULL,
    data bytea NOT NULL,
    size integer,
    uploaded_by_id integer,
    uploaded_at timestamp without time zone,
    tracey_tenant_id text DEFAULT '7ff12271-cb84-4354-9fb1-082900c387e8'::text NOT NULL
);

ALTER TABLE ONLY public.uploaded_files FORCE ROW LEVEL SECURITY;


--
-- Name: user_machines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_machines (
    user_id integer NOT NULL,
    machine_id integer NOT NULL,
    tracey_tenant_id text DEFAULT '7ff12271-cb84-4354-9fb1-082900c387e8'::text NOT NULL
);

ALTER TABLE ONLY public.user_machines FORCE ROW LEVEL SECURITY;


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id integer NOT NULL,
    email character varying(255) NOT NULL,
    name character varying(255) NOT NULL,
    first_name character varying(120),
    last_name character varying(120),
    password_hash character varying(255) NOT NULL,
    role character varying(20) NOT NULL,
    is_active_flag boolean,
    created_at timestamp without time zone,
    phone character varying(30),
    department_id integer,
    employer_id integer,
    start_date date,
    termination_date date,
    photo_filename character varying(500),
    job_title character varying(120),
    manager_id integer,
    position_id integer,
    tracey_user_id character varying(36),
    tracey_tenant_id character varying(36) DEFAULT '7ff12271-cb84-4354-9fb1-082900c387e8'::character varying
);


--
-- Name: users_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;


--
-- Name: whs_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.whs_records (
    id integer NOT NULL,
    kind character varying(32) NOT NULL,
    user_id integer,
    title character varying(200) NOT NULL,
    issued_on date,
    expires_on date,
    notes text,
    document_filename character varying(500),
    last_reminded_at timestamp without time zone,
    incident_date date,
    severity character varying(32),
    reported_by_id integer,
    created_at timestamp without time zone,
    tracey_tenant_id text DEFAULT '7ff12271-cb84-4354-9fb1-082900c387e8'::text NOT NULL
);

ALTER TABLE ONLY public.whs_records FORCE ROW LEVEL SECURITY;


--
-- Name: whs_records_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.whs_records_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: whs_records_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.whs_records_id_seq OWNED BY public.whs_records.id;


--
-- Name: assignments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assignments ALTER COLUMN id SET DEFAULT nextval('public.assignments_id_seq'::regclass);


--
-- Name: attempts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attempts ALTER COLUMN id SET DEFAULT nextval('public.attempts_id_seq'::regclass);


--
-- Name: audit_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs ALTER COLUMN id SET DEFAULT nextval('public.audit_logs_id_seq'::regclass);


--
-- Name: choices id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.choices ALTER COLUMN id SET DEFAULT nextval('public.choices_id_seq'::regclass);


--
-- Name: content_item_media id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_item_media ALTER COLUMN id SET DEFAULT nextval('public.content_item_media_id_seq'::regclass);


--
-- Name: content_items id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_items ALTER COLUMN id SET DEFAULT nextval('public.content_items_id_seq'::regclass);


--
-- Name: department_module_policies id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.department_module_policies ALTER COLUMN id SET DEFAULT nextval('public.department_module_policies_id_seq'::regclass);


--
-- Name: departments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.departments ALTER COLUMN id SET DEFAULT nextval('public.departments_id_seq'::regclass);


--
-- Name: employers id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employers ALTER COLUMN id SET DEFAULT nextval('public.employers_id_seq'::regclass);


--
-- Name: machines id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.machines ALTER COLUMN id SET DEFAULT nextval('public.machines_id_seq'::regclass);


--
-- Name: module_media id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.module_media ALTER COLUMN id SET DEFAULT nextval('public.module_media_id_seq'::regclass);


--
-- Name: module_versions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.module_versions ALTER COLUMN id SET DEFAULT nextval('public.module_versions_id_seq'::regclass);


--
-- Name: modules id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.modules ALTER COLUMN id SET DEFAULT nextval('public.modules_id_seq'::regclass);


--
-- Name: positions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.positions ALTER COLUMN id SET DEFAULT nextval('public.positions_id_seq'::regclass);


--
-- Name: questions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.questions ALTER COLUMN id SET DEFAULT nextval('public.questions_id_seq'::regclass);


--
-- Name: users id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);


--
-- Name: whs_records id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whs_records ALTER COLUMN id SET DEFAULT nextval('public.whs_records_id_seq'::regclass);


--
-- Name: assignments assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assignments
    ADD CONSTRAINT assignments_pkey PRIMARY KEY (id);


--
-- Name: attempts attempts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attempts
    ADD CONSTRAINT attempts_pkey PRIMARY KEY (id);


--
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);


--
-- Name: choices choices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.choices
    ADD CONSTRAINT choices_pkey PRIMARY KEY (id);


--
-- Name: content_item_media content_item_media_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_item_media
    ADD CONSTRAINT content_item_media_pkey PRIMARY KEY (id);


--
-- Name: content_items content_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_items
    ADD CONSTRAINT content_items_pkey PRIMARY KEY (id);


--
-- Name: department_module_policies department_module_policies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.department_module_policies
    ADD CONSTRAINT department_module_policies_pkey PRIMARY KEY (id);


--
-- Name: departments departments_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.departments
    ADD CONSTRAINT departments_name_key UNIQUE (name);


--
-- Name: departments departments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.departments
    ADD CONSTRAINT departments_pkey PRIMARY KEY (id);


--
-- Name: employers employers_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employers
    ADD CONSTRAINT employers_name_key UNIQUE (name);


--
-- Name: employers employers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employers
    ADD CONSTRAINT employers_pkey PRIMARY KEY (id);


--
-- Name: machine_modules machine_modules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.machine_modules
    ADD CONSTRAINT machine_modules_pkey PRIMARY KEY (machine_id, module_id);


--
-- Name: machines machines_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.machines
    ADD CONSTRAINT machines_name_key UNIQUE (name);


--
-- Name: machines machines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.machines
    ADD CONSTRAINT machines_pkey PRIMARY KEY (id);


--
-- Name: module_media module_media_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.module_media
    ADD CONSTRAINT module_media_pkey PRIMARY KEY (id);


--
-- Name: module_versions module_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.module_versions
    ADD CONSTRAINT module_versions_pkey PRIMARY KEY (id);


--
-- Name: modules modules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.modules
    ADD CONSTRAINT modules_pkey PRIMARY KEY (id);


--
-- Name: positions positions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.positions
    ADD CONSTRAINT positions_pkey PRIMARY KEY (id);


--
-- Name: questions questions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.questions
    ADD CONSTRAINT questions_pkey PRIMARY KEY (id);


--
-- Name: uploaded_files uploaded_files_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.uploaded_files
    ADD CONSTRAINT uploaded_files_pkey PRIMARY KEY (filename);


--
-- Name: department_module_policies uq_dept_module_policy; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.department_module_policies
    ADD CONSTRAINT uq_dept_module_policy UNIQUE (department_id, module_id);


--
-- Name: module_versions uq_module_version_number; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.module_versions
    ADD CONSTRAINT uq_module_version_number UNIQUE (module_id, version_number);


--
-- Name: assignments uq_user_module; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assignments
    ADD CONSTRAINT uq_user_module UNIQUE (user_id, module_id);


--
-- Name: user_machines user_machines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_machines
    ADD CONSTRAINT user_machines_pkey PRIMARY KEY (user_id, machine_id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: whs_records whs_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whs_records
    ADD CONSTRAINT whs_records_pkey PRIMARY KEY (id);


--
-- Name: assignments_tenant_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX assignments_tenant_idx ON public.assignments USING btree (tracey_tenant_id);


--
-- Name: attempts_tenant_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX attempts_tenant_idx ON public.attempts USING btree (tracey_tenant_id);


--
-- Name: audit_logs_tenant_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_logs_tenant_idx ON public.audit_logs USING btree (tracey_tenant_id);


--
-- Name: choices_tenant_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX choices_tenant_idx ON public.choices USING btree (tracey_tenant_id);


--
-- Name: content_item_media_tenant_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX content_item_media_tenant_idx ON public.content_item_media USING btree (tracey_tenant_id);


--
-- Name: content_items_tenant_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX content_items_tenant_idx ON public.content_items USING btree (tracey_tenant_id);


--
-- Name: department_module_policies_tenant_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX department_module_policies_tenant_idx ON public.department_module_policies USING btree (tracey_tenant_id);


--
-- Name: departments_tenant_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX departments_tenant_idx ON public.departments USING btree (tracey_tenant_id);


--
-- Name: employers_tenant_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX employers_tenant_idx ON public.employers USING btree (tracey_tenant_id);


--
-- Name: ix_audit_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_audit_entity ON public.audit_logs USING btree (entity_type, entity_id);


--
-- Name: ix_audit_logs_action; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_audit_logs_action ON public.audit_logs USING btree (action);


--
-- Name: ix_audit_logs_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_audit_logs_created_at ON public.audit_logs USING btree (created_at);


--
-- Name: ix_audit_logs_entity_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_audit_logs_entity_id ON public.audit_logs USING btree (entity_id);


--
-- Name: ix_audit_logs_entity_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_audit_logs_entity_type ON public.audit_logs USING btree (entity_type);


--
-- Name: ix_audit_logs_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_audit_logs_user_id ON public.audit_logs USING btree (user_id);


--
-- Name: ix_content_item_media_content_item_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_content_item_media_content_item_id ON public.content_item_media USING btree (content_item_id);


--
-- Name: ix_department_module_policies_department_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_department_module_policies_department_id ON public.department_module_policies USING btree (department_id);


--
-- Name: ix_department_module_policies_module_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_department_module_policies_module_id ON public.department_module_policies USING btree (module_id);


--
-- Name: ix_module_media_module_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_module_media_module_id ON public.module_media USING btree (module_id);


--
-- Name: ix_positions_parent_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_positions_parent_id ON public.positions USING btree (parent_id);


--
-- Name: ix_users_email; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ix_users_email ON public.users USING btree (email);


--
-- Name: ix_users_position_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_users_position_id ON public.users USING btree (position_id);


--
-- Name: ix_users_tracey_tenant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_users_tracey_tenant_id ON public.users USING btree (tracey_tenant_id);


--
-- Name: ix_users_tracey_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ix_users_tracey_user_id ON public.users USING btree (tracey_user_id);


--
-- Name: ix_whs_records_expires_on; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_whs_records_expires_on ON public.whs_records USING btree (expires_on);


--
-- Name: ix_whs_records_kind; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_whs_records_kind ON public.whs_records USING btree (kind);


--
-- Name: ix_whs_records_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_whs_records_user_id ON public.whs_records USING btree (user_id);


--
-- Name: machine_modules_tenant_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX machine_modules_tenant_idx ON public.machine_modules USING btree (tracey_tenant_id);


--
-- Name: machines_tenant_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX machines_tenant_idx ON public.machines USING btree (tracey_tenant_id);


--
-- Name: module_media_tenant_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX module_media_tenant_idx ON public.module_media USING btree (tracey_tenant_id);


--
-- Name: module_versions_tenant_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX module_versions_tenant_idx ON public.module_versions USING btree (tracey_tenant_id);


--
-- Name: modules_tenant_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX modules_tenant_idx ON public.modules USING btree (tracey_tenant_id);


--
-- Name: positions_tenant_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX positions_tenant_idx ON public.positions USING btree (tracey_tenant_id);


--
-- Name: questions_tenant_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX questions_tenant_idx ON public.questions USING btree (tracey_tenant_id);


--
-- Name: uploaded_files_tenant_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX uploaded_files_tenant_idx ON public.uploaded_files USING btree (tracey_tenant_id);


--
-- Name: user_machines_tenant_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_machines_tenant_idx ON public.user_machines USING btree (tracey_tenant_id);


--
-- Name: whs_records_tenant_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX whs_records_tenant_idx ON public.whs_records USING btree (tracey_tenant_id);


--
-- Name: assignments assignments_module_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assignments
    ADD CONSTRAINT assignments_module_id_fkey FOREIGN KEY (module_id) REFERENCES public.modules(id);


--
-- Name: assignments assignments_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assignments
    ADD CONSTRAINT assignments_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: assignments assignments_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assignments
    ADD CONSTRAINT assignments_version_id_fkey FOREIGN KEY (version_id) REFERENCES public.module_versions(id);


--
-- Name: attempts attempts_module_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attempts
    ADD CONSTRAINT attempts_module_id_fkey FOREIGN KEY (module_id) REFERENCES public.modules(id);


--
-- Name: attempts attempts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attempts
    ADD CONSTRAINT attempts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: audit_logs audit_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: choices choices_question_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.choices
    ADD CONSTRAINT choices_question_id_fkey FOREIGN KEY (question_id) REFERENCES public.questions(id);


--
-- Name: content_item_media content_item_media_content_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_item_media
    ADD CONSTRAINT content_item_media_content_item_id_fkey FOREIGN KEY (content_item_id) REFERENCES public.content_items(id);


--
-- Name: content_items content_items_module_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_items
    ADD CONSTRAINT content_items_module_id_fkey FOREIGN KEY (module_id) REFERENCES public.modules(id);


--
-- Name: department_module_policies department_module_policies_department_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.department_module_policies
    ADD CONSTRAINT department_module_policies_department_id_fkey FOREIGN KEY (department_id) REFERENCES public.departments(id) ON DELETE CASCADE;


--
-- Name: department_module_policies department_module_policies_module_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.department_module_policies
    ADD CONSTRAINT department_module_policies_module_id_fkey FOREIGN KEY (module_id) REFERENCES public.modules(id) ON DELETE CASCADE;


--
-- Name: machine_modules machine_modules_machine_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.machine_modules
    ADD CONSTRAINT machine_modules_machine_id_fkey FOREIGN KEY (machine_id) REFERENCES public.machines(id) ON DELETE CASCADE;


--
-- Name: machine_modules machine_modules_module_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.machine_modules
    ADD CONSTRAINT machine_modules_module_id_fkey FOREIGN KEY (module_id) REFERENCES public.modules(id) ON DELETE CASCADE;


--
-- Name: machines machines_department_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.machines
    ADD CONSTRAINT machines_department_id_fkey FOREIGN KEY (department_id) REFERENCES public.departments(id);


--
-- Name: module_media module_media_module_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.module_media
    ADD CONSTRAINT module_media_module_id_fkey FOREIGN KEY (module_id) REFERENCES public.modules(id);


--
-- Name: module_versions module_versions_created_by_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.module_versions
    ADD CONSTRAINT module_versions_created_by_id_fkey FOREIGN KEY (created_by_id) REFERENCES public.users(id);


--
-- Name: module_versions module_versions_module_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.module_versions
    ADD CONSTRAINT module_versions_module_id_fkey FOREIGN KEY (module_id) REFERENCES public.modules(id);


--
-- Name: modules modules_created_by_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.modules
    ADD CONSTRAINT modules_created_by_id_fkey FOREIGN KEY (created_by_id) REFERENCES public.users(id);


--
-- Name: positions positions_department_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.positions
    ADD CONSTRAINT positions_department_id_fkey FOREIGN KEY (department_id) REFERENCES public.departments(id);


--
-- Name: positions positions_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.positions
    ADD CONSTRAINT positions_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.positions(id) ON DELETE SET NULL;


--
-- Name: questions questions_module_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.questions
    ADD CONSTRAINT questions_module_id_fkey FOREIGN KEY (module_id) REFERENCES public.modules(id);


--
-- Name: uploaded_files uploaded_files_uploaded_by_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.uploaded_files
    ADD CONSTRAINT uploaded_files_uploaded_by_id_fkey FOREIGN KEY (uploaded_by_id) REFERENCES public.users(id);


--
-- Name: user_machines user_machines_machine_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_machines
    ADD CONSTRAINT user_machines_machine_id_fkey FOREIGN KEY (machine_id) REFERENCES public.machines(id) ON DELETE CASCADE;


--
-- Name: user_machines user_machines_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_machines
    ADD CONSTRAINT user_machines_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: users users_department_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_department_id_fkey FOREIGN KEY (department_id) REFERENCES public.departments(id);


--
-- Name: users users_employer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_employer_id_fkey FOREIGN KEY (employer_id) REFERENCES public.employers(id);


--
-- Name: users users_manager_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_manager_id_fkey FOREIGN KEY (manager_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: users users_position_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_position_id_fkey FOREIGN KEY (position_id) REFERENCES public.positions(id) ON DELETE SET NULL;


--
-- Name: whs_records whs_records_reported_by_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whs_records
    ADD CONSTRAINT whs_records_reported_by_id_fkey FOREIGN KEY (reported_by_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: whs_records whs_records_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whs_records
    ADD CONSTRAINT whs_records_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: assignments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.assignments ENABLE ROW LEVEL SECURITY;

--
-- Name: attempts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.attempts ENABLE ROW LEVEL SECURITY;

--
-- Name: audit_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: choices; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.choices ENABLE ROW LEVEL SECURITY;

--
-- Name: content_item_media; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.content_item_media ENABLE ROW LEVEL SECURITY;

--
-- Name: content_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.content_items ENABLE ROW LEVEL SECURITY;

--
-- Name: department_module_policies; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.department_module_policies ENABLE ROW LEVEL SECURITY;

--
-- Name: departments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;

--
-- Name: employers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.employers ENABLE ROW LEVEL SECURITY;

--
-- Name: machine_modules; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.machine_modules ENABLE ROW LEVEL SECURITY;

--
-- Name: machines; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.machines ENABLE ROW LEVEL SECURITY;

--
-- Name: module_media; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.module_media ENABLE ROW LEVEL SECURITY;

--
-- Name: module_versions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.module_versions ENABLE ROW LEVEL SECURITY;

--
-- Name: modules; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.modules ENABLE ROW LEVEL SECURITY;

--
-- Name: positions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.positions ENABLE ROW LEVEL SECURITY;

--
-- Name: questions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.questions ENABLE ROW LEVEL SECURITY;

--
-- Name: assignments tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.assignments USING ((tracey_tenant_id = current_setting('app.tenant_id'::text, true))) WITH CHECK ((tracey_tenant_id = current_setting('app.tenant_id'::text, true)));


--
-- Name: attempts tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.attempts USING ((tracey_tenant_id = current_setting('app.tenant_id'::text, true))) WITH CHECK ((tracey_tenant_id = current_setting('app.tenant_id'::text, true)));


--
-- Name: audit_logs tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.audit_logs USING ((tracey_tenant_id = current_setting('app.tenant_id'::text, true))) WITH CHECK ((tracey_tenant_id = current_setting('app.tenant_id'::text, true)));


--
-- Name: choices tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.choices USING ((tracey_tenant_id = current_setting('app.tenant_id'::text, true))) WITH CHECK ((tracey_tenant_id = current_setting('app.tenant_id'::text, true)));


--
-- Name: content_item_media tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.content_item_media USING ((tracey_tenant_id = current_setting('app.tenant_id'::text, true))) WITH CHECK ((tracey_tenant_id = current_setting('app.tenant_id'::text, true)));


--
-- Name: content_items tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.content_items USING ((tracey_tenant_id = current_setting('app.tenant_id'::text, true))) WITH CHECK ((tracey_tenant_id = current_setting('app.tenant_id'::text, true)));


--
-- Name: department_module_policies tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.department_module_policies USING ((tracey_tenant_id = current_setting('app.tenant_id'::text, true))) WITH CHECK ((tracey_tenant_id = current_setting('app.tenant_id'::text, true)));


--
-- Name: departments tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.departments USING ((tracey_tenant_id = current_setting('app.tenant_id'::text, true))) WITH CHECK ((tracey_tenant_id = current_setting('app.tenant_id'::text, true)));


--
-- Name: employers tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.employers USING ((tracey_tenant_id = current_setting('app.tenant_id'::text, true))) WITH CHECK ((tracey_tenant_id = current_setting('app.tenant_id'::text, true)));


--
-- Name: machine_modules tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.machine_modules USING ((tracey_tenant_id = current_setting('app.tenant_id'::text, true))) WITH CHECK ((tracey_tenant_id = current_setting('app.tenant_id'::text, true)));


--
-- Name: machines tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.machines USING ((tracey_tenant_id = current_setting('app.tenant_id'::text, true))) WITH CHECK ((tracey_tenant_id = current_setting('app.tenant_id'::text, true)));


--
-- Name: module_media tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.module_media USING ((tracey_tenant_id = current_setting('app.tenant_id'::text, true))) WITH CHECK ((tracey_tenant_id = current_setting('app.tenant_id'::text, true)));


--
-- Name: module_versions tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.module_versions USING ((tracey_tenant_id = current_setting('app.tenant_id'::text, true))) WITH CHECK ((tracey_tenant_id = current_setting('app.tenant_id'::text, true)));


--
-- Name: modules tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.modules USING ((tracey_tenant_id = current_setting('app.tenant_id'::text, true))) WITH CHECK ((tracey_tenant_id = current_setting('app.tenant_id'::text, true)));


--
-- Name: positions tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.positions USING ((tracey_tenant_id = current_setting('app.tenant_id'::text, true))) WITH CHECK ((tracey_tenant_id = current_setting('app.tenant_id'::text, true)));


--
-- Name: questions tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.questions USING ((tracey_tenant_id = current_setting('app.tenant_id'::text, true))) WITH CHECK ((tracey_tenant_id = current_setting('app.tenant_id'::text, true)));


--
-- Name: uploaded_files tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.uploaded_files USING ((tracey_tenant_id = current_setting('app.tenant_id'::text, true))) WITH CHECK ((tracey_tenant_id = current_setting('app.tenant_id'::text, true)));


--
-- Name: user_machines tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.user_machines USING ((tracey_tenant_id = current_setting('app.tenant_id'::text, true))) WITH CHECK ((tracey_tenant_id = current_setting('app.tenant_id'::text, true)));


--
-- Name: whs_records tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.whs_records USING ((tracey_tenant_id = current_setting('app.tenant_id'::text, true))) WITH CHECK ((tracey_tenant_id = current_setting('app.tenant_id'::text, true)));


--
-- Name: uploaded_files; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.uploaded_files ENABLE ROW LEVEL SECURITY;

--
-- Name: user_machines; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_machines ENABLE ROW LEVEL SECURITY;

--
-- Name: whs_records; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.whs_records ENABLE ROW LEVEL SECURITY;

--
-- PostgreSQL database dump complete
--

\unrestrict 8Xwgdr5l8yp9z7SDjlPeumphScD108LKf6n1py3ZG8jYBLNEnj40giTnJiGVwbr

