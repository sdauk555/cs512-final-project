const rayTracer = `#version 300 es
    precision highp float;
    precision highp int;
    // Elevated daylight illuminates the upper stories as well as the streets.
    const vec3 LIGHT = vec3(-400.0, 650.0, 350.0);
    const int MAX_BOUNCES = 6;
    const float GLASS_IOR = 1.5;
    const float SCHLICK_THRESHOLD = 0.01;
    const float SHININESS = 64.0;

    struct Ray {
        vec3 origin;
        vec3 direction;
    };

    struct HitData {
        bool hit;
        float t;
        vec3 point;
        vec3 normal;
        vec3 color;
        float reflectivity;
        float specular;
        bool isGlass;
    };

    bool intersectBox(Ray ray, vec3 center, vec3 halfExtents, out float t, out vec3 normal) {
        vec3 t0s = (center - halfExtents - ray.origin) / ray.direction;
        vec3 t1s = (center + halfExtents - ray.origin) / ray.direction;
        vec3 tmin = min(t0s, t1s);
        vec3 tmax = max(t0s, t1s);
        float t0 = max(max(tmin.x, tmin.y), tmin.z);
        float t1 = min(min(tmax.x, tmax.y), tmax.z);
        if (t1 < 0.0 || t0 > t1) {
            return false;
        }

        t = t0 > 0.001 ? t0 : t1;
        if (t < 0.001) {
            return false;
        }

        vec3 local = (ray.origin + ray.direction * t - center) / halfExtents;
        vec3 a = abs(local);
        if (a.x > a.y && a.x > a.z) {
            normal = vec3(sign(local.x), 0.0, 0.0);
        } else if (a.y > a.z) {
            normal = vec3(0.0, sign(local.y), 0.0);
        } else {
            normal = vec3(0.0, 0.0, sign(local.z));
        }

        return true;
    }

    bool intersectSphere(Ray ray, vec3 center, float radius, out float t, out vec3 normal) {
        vec3 oc = ray.origin - center;
        float b = dot(oc, ray.direction);
        float d = b * b - dot(oc, oc) + radius * radius;
        if (d < 0.0) {
            return false;
        }

        t = -b - sqrt(d);
        if (t < 0.001) {
            t = -b + sqrt(d);
        }

        if (t < 0.001) {
            return false;
        }

        normal = (ray.origin + ray.direction * t - center) / radius;
        return true;
    }

    bool intersectCylinder(Ray ray, vec3 center, float radius, float halfHeight, out float t, out vec3 normal) {
        vec3 o = ray.origin - center;
        vec3 d = ray.direction;
        float best = 1e10;
        float a = dot(d.xz, d.xz);
        float b = dot(o.xz, d.xz);
        float c = dot(o.xz, o.xz) - radius * radius;
        float disc = b * b - a * c;
        if (a > 1e-6 && disc >= 0.0) {
            float s = sqrt(disc);
            for (int i = 0; i < 2; i++) {
                float ts = (-b + (i == 0 ? -s : s)) / a;
                float y = o.y + ts * d.y;
                if (ts > 0.001 && ts < best && abs(y) <= halfHeight) {
                    best = ts;
                    vec3 p = o + ts * d;
                    normal = normalize(vec3(p.x, 0.0, p.z));
                }
            }
        }

        if (abs(d.y) > 1e-6) {
            for (int i = 0; i < 2; i++) {
                float sgn = (i == 0) ? -1.0 : 1.0;
                float tc = (sgn * halfHeight - o.y) / d.y;
                vec2 p = o.xz + tc * d.xz;
                if (tc > 0.001 && tc < best && dot(p, p) <= radius * radius) {
                    best = tc;
                    normal = vec3(0.0, sgn, 0.0);
                }
            }
        }

        if (best > 1e9) {
            return false;
        }

        t = best;
        return true;
    }

    bool intersectCone(Ray ray, vec3 center, float radius, float halfHeight, out float t, out vec3 normal) {
        vec3 o = ray.origin - center;
        vec3 d = ray.direction;
        float best = 1e10;
        float k = radius / (2.0 * halfHeight);
        float k2 = k * k;
        float q = halfHeight - o.y;
        float a = dot(d.xz, d.xz) - k2 * d.y * d.y;
        float b = dot(o.xz, d.xz) + k2 * q * d.y;
        float c = dot(o.xz, o.xz) - k2 * q * q;
        float disc = b * b - a * c;
        if (abs(a) > 1e-6 && disc >= 0.0) {
            float s = sqrt(disc);
            for (int i = 0; i < 2; i++) {
                float ts = (-b + (i == 0 ? -s : s)) / a;
                float y = o.y + ts * d.y;
                if (ts > 0.001 && ts < best && y >= -halfHeight && y <= halfHeight) {
                    best = ts;
                    vec3 p = o + ts * d;
                    normal = normalize(vec3(p.x, k2 * (halfHeight - p.y), p.z));
                }
            }
        }

        if (abs(d.y) > 1e-6) {
            float tc = (-halfHeight - o.y) / d.y;
            vec2 p = o.xz + tc * d.xz;
            if (tc > 0.001 && tc < best && dot(p, p) <= radius * radius) {
                best = tc;
                normal = vec3(0.0, -1.0, 0.0);
            }
        }

        if (best > 1e9) {
            return false;
        }

        t = best;
        return true;
    }

    vec3 refraction(vec3 I, vec3 N, float eta) {
        float cosI = -dot(I, N);
        float k = 1.0 - eta * eta * (1.0 - cosI * cosI);
        if (k < 0.0) return vec3(0.0);
        float cosT = sqrt(k);
        return eta * I + (eta * cosI - cosT) * N;
    }

    float schlick(float cosine, float ref_idx) {
        float f0 = (1.0 - ref_idx) / (1.0 + ref_idx);
        f0 *= f0;
        return f0 + (1.0 - f0) * pow(1.0 - cosine, 5.0);
    }

    ${PLANE}
    ${SURFACE}
    ${BUILDING.shader}
    ${CITY.shader}

    HitData traceScene(Ray ray) {
        HitData hit = intersectPlane(ray, planePos, planeRot);
        intersectCity(ray, hit);
        intersectBuildings(ray, hit);
        intersectSurface(ray, hit);
        return hit;
    }

    vec3 skyColor(vec3 dir) {
        float t = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
        vec3 horizon = vec3(0.85, 0.93, 1.00);
        vec3 zenith = vec3(0.25, 0.55, 0.95);
        vec3 sky = mix(horizon, zenith, pow(t, 0.7));
        vec3 sunDir = normalize(LIGHT);
        float s = max(dot(dir, sunDir), 0.0);
        vec3 sunColor = vec3(1.0, 0.92, 0.75);
        float disc = smoothstep(0.998, 0.999, s);
        float glow = pow(s, 64.0) * 0.5 + pow(s, 8.0) * 0.15;
        return sky + sunColor * (glow + disc * 4.0);
    }

    vec3 trace(Ray ray) {
        vec3 color = vec3(0.0);
        vec3 attenuation = vec3(1.0);
        Ray pendingRays[MAX_BOUNCES];
        vec3 pendingWeights[MAX_BOUNCES];
        int pendingDepths[MAX_BOUNCES];
        int pending = 0;
        int depth = 0;

        for (int step = 0; step < 48; step++) {
            if (depth >= MAX_BOUNCES || max(attenuation.r, max(attenuation.g, attenuation.b)) < 0.01) {
                if (pending == 0) break;
                pending--;
                ray = pendingRays[pending];
                attenuation = pendingWeights[pending];
                depth = pendingDepths[pending];
            }
            HitData hit = traceScene(ray);
            depth++;
            if (!hit.hit) {
                color += attenuation * skyColor(ray.direction);
                depth = MAX_BOUNCES;
                continue;
            }

            if (hit.isGlass) {
                vec3 N = hit.normal;
                float n1 = 1.0, n2 = GLASS_IOR;
                if (dot(ray.direction, N) > 0.0) {
                    N = -N;
                    n1 = GLASS_IOR; n2 = 1.0;
                }

                float eta = n1 / n2;
                float cosI = -dot(ray.direction, N);
                float sin2T = eta * eta * (1.0 - cosI * cosI);
                bool total_internal_reflection = sin2T > 1.0;
                float schlick_value = 1.0;
                if (!total_internal_reflection) {
                    float cosT = sqrt(1.0 - sin2T);
                    float c = (n1 > n2) ? cosT : cosI;
                    schlick_value = schlick(c, n2 / n1);
                }

                vec3 direction;
                if (total_internal_reflection) {
                    direction = reflect(ray.direction, N);
                } else {
                    if (schlick_value > SCHLICK_THRESHOLD && pending < MAX_BOUNCES && depth < MAX_BOUNCES) {
                        vec3 reflected = reflect(ray.direction, N);
                        pendingRays[pending] = Ray(hit.point + reflected * 0.001, reflected);
                        pendingWeights[pending] = attenuation * schlick_value;
                        pendingDepths[pending] = depth;
                        pending++;
                    }
                    attenuation *= 1.0 - schlick_value;
                    direction = refraction(ray.direction, N, eta);
                }

                ray = Ray(hit.point + direction * 0.001, direction);
                attenuation *= hit.color;
                continue;
            }

            vec3 toLight = LIGHT - hit.point;
            float dist = length(toLight);
            vec3 L = toLight / dist;
            Ray shadow = Ray(hit.point + hit.normal * 0.001, L);
            float visible = 1.0;
            float remaining = dist;
            for (int pane = 0; pane < 10; pane++) {
                HitData blocker = traceScene(shadow);
                if (!blocker.hit || blocker.t >= remaining) break;
                if (!blocker.isGlass) { visible = 0.0; break; }
                visible *= 0.96;
                remaining -= blocker.t + 0.001;
                shadow.origin = blocker.point + L * 0.001;
                if (pane == 9) visible = 0.0;
            }
            float diff = max(dot(hit.normal, L), 0.0) * visible;
            vec3 V = -ray.direction;
            vec3 R = reflect(-L, hit.normal);
            float spec = pow(max(dot(R, V), 0.0), SHININESS) * visible;
            vec3 shading = hit.color * (0.2 + 0.8 * diff) + vec3(hit.specular * spec);
            color += attenuation * shading * (1.0 - hit.reflectivity);
            if (hit.reflectivity == 0.0) {
                depth = MAX_BOUNCES;
                continue;
            }

            attenuation *= hit.reflectivity * hit.color;
            ray = Ray(hit.point + hit.normal * 0.001, reflect(ray.direction, hit.normal));
        }

        return color;
    }`;
