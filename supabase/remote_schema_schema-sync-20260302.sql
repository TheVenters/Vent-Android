-- File purpose: Supabase SQL reference file or schema snapshot used for database setup and comparison.

--
-- PostgreSQL database dump
--

\restrict NH42I9sFAOaYtA7gRJ88b6ejVGqLfurUWUxAyx4558LpLnux2b8qVpQTYHzzozI

-- Dumped from database version 17.6
-- Dumped by pg_dump version 18.2

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

CREATE SCHEMA public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: communities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.communities (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slug text NOT NULL,
    name text NOT NULL,
    description text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: community_layers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.community_layers (
    community_id uuid NOT NULL,
    layer_id uuid NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: layers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.layers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    kind text NOT NULL,
    name text NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: overlay_features; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.overlay_features (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    layer_id uuid NOT NULL,
    geom jsonb NOT NULL,
    props jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: communities communities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.communities
    ADD CONSTRAINT communities_pkey PRIMARY KEY (id);


--
-- Name: communities communities_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.communities
    ADD CONSTRAINT communities_slug_key UNIQUE (slug);


--
-- Name: community_layers community_layers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_layers
    ADD CONSTRAINT community_layers_pkey PRIMARY KEY (community_id, layer_id);


--
-- Name: layers layers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.layers
    ADD CONSTRAINT layers_pkey PRIMARY KEY (id);


--
-- Name: overlay_features overlay_features_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.overlay_features
    ADD CONSTRAINT overlay_features_pkey PRIMARY KEY (id);


--
-- Name: community_layers_community_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX community_layers_community_id_idx ON public.community_layers USING btree (community_id);


--
-- Name: community_layers_layer_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX community_layers_layer_id_idx ON public.community_layers USING btree (layer_id);


--
-- Name: overlay_features_layer_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX overlay_features_layer_id_idx ON public.overlay_features USING btree (layer_id);


--
-- Name: community_layers community_layers_community_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_layers
    ADD CONSTRAINT community_layers_community_id_fkey FOREIGN KEY (community_id) REFERENCES public.communities(id) ON DELETE CASCADE;


--
-- Name: community_layers community_layers_layer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_layers
    ADD CONSTRAINT community_layers_layer_id_fkey FOREIGN KEY (layer_id) REFERENCES public.layers(id) ON DELETE RESTRICT;


--
-- Name: overlay_features overlay_features_layer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.overlay_features
    ADD CONSTRAINT overlay_features_layer_id_fkey FOREIGN KEY (layer_id) REFERENCES public.layers(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict NH42I9sFAOaYtA7gRJ88b6ejVGqLfurUWUxAyx4558LpLnux2b8qVpQTYHzzozI

