import store


def _post(client, jpg, query=""):
    return client.post(f"/api/predict{query}", files={"file": ("a.jpg", jpg, "image/jpeg")})


def test_health(client):
    r = client.get("/api/health")
    assert r.status_code == 200 and r.json()["classifier_loaded"] is True


def test_predict_grades_detected_fruit(client, apple_jpg):
    r = _post(client, apple_jpg, "?log=true")
    assert r.status_code == 200
    det = r.json()["detections"][0]
    assert det["fruit"] == "apple" and det["label"] == "rotten_apple" and det["tier"] == "reject"
    assert det["box"] == [20, 20, 100, 100]
    assert store.all_rows()[0][1:3] == ("apple", "reject")


def test_predict_rejects_bad_mode(client, apple_jpg):
    assert _post(client, apple_jpg, "?mode=nope").status_code == 422


def test_predict_survives_model_error(client, apple_jpg):
    import main

    def boom(*a, **k):
        raise RuntimeError("boom")
    main.pipeline.classifier.predict = boom
    r = _post(client, apple_jpg)
    assert r.status_code == 500 and "boom" in r.json()["error"]


def test_forecast_endpoint(client):
    body = client.get("/api/forecast").json()
    assert len(body["forecast"]["values"]) == 7 and "action_plan" in body


def test_metric_endpoints(client):
    assert "per_class_recall" in client.get("/api/eval").json()
    assert len(client.get("/api/model_report").json()["classes"]) == 20


def test_transformer_endpoint(client):
    assert isinstance(client.get("/api/transformer").json(), dict)


def test_drift_endpoint(client):
    assert client.get("/api/drift").json()["alerts"] == []
    assert len(client.get("/api/drift?demo=true").json()["alerts"]) == 3
