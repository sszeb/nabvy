-- Grant schema usage
grant usage on schema suspected_labels to nabvy_app, nabvy_pipeline;

-- correction_requests: user-owned table
grant select, insert, update, delete on suspected_labels.correction_requests to nabvy_app;
select nabvy_core.enable_user_rls('suspected_labels.correction_requests', 'requester_user_id');
grant select on suspected_labels.correction_requests to nabvy_pipeline;
select nabvy_core.allow_pipeline('suspected_labels.correction_requests', 'select');
select nabvy_core.track_updated_at('suspected_labels.correction_requests');

-- Pipeline-written tables (evaluations, candidates, labels, approvals, reviews, rules)
grant select, insert, update, delete on suspected_labels.evaluations to nabvy_pipeline;
select nabvy_core.allow_pipeline('suspected_labels.evaluations', 'all');
select nabvy_core.track_updated_at('suspected_labels.evaluations');

grant select, insert, update, delete on suspected_labels.candidates to nabvy_pipeline;
select nabvy_core.allow_pipeline('suspected_labels.candidates', 'all');
select nabvy_core.track_updated_at('suspected_labels.candidates');

grant select, insert, update, delete on suspected_labels.labels to nabvy_pipeline;
select nabvy_core.allow_pipeline('suspected_labels.labels', 'all');
select nabvy_core.track_updated_at('suspected_labels.labels');

grant select, insert, update, delete on suspected_labels.approvals to nabvy_pipeline;
select nabvy_core.allow_pipeline('suspected_labels.approvals', 'all');
select nabvy_core.track_updated_at('suspected_labels.approvals');

grant select, insert, update, delete on suspected_labels.reviews to nabvy_pipeline;
select nabvy_core.allow_pipeline('suspected_labels.reviews', 'all');
select nabvy_core.track_updated_at('suspected_labels.reviews');

grant select, insert, update, delete on suspected_labels.rules to nabvy_pipeline;
select nabvy_core.allow_pipeline('suspected_labels.rules', 'all');
select nabvy_core.track_updated_at('suspected_labels.rules');
