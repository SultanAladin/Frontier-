//============================================================================================================================================
// 📦 Frontier/Scratchpad/RockFieldProof/GlslCompatSpecification.h — GLSL Vector Semantics for Host Side Kernel Verification
//============================================================================================================================================
//
// Lets Shaders/RockFieldSpace.glsl compile verbatim as C++20 so the geologic field can be inspected, measured and
// regression tested on the CPU. Scratchpad only: this never enters the engine build.
//
//============================================================================================================================================

#pragma once

#include <cmath>
#include <cstdint>
#include <algorithm>
#include <type_traits>

//------------------------------------------------------------------------------------------------------------------------
//                                                    SCALAR INTRINSICS
//------------------------------------------------------------------------------------------------------------------------

using uint = std::uint32_t;

// GLSL treats every unsuffixed literal in a float expression as a float. These arithmetic-constrained overloads
// reproduce that so the shared kernel needs no C++ specific literal suffixes.
template<typename T>
inline constexpr bool IsScalar = std::is_arithmetic_v<T>;

template<typename A, typename B, std::enable_if_t<IsScalar<A> && IsScalar<B>, int> = 0>
inline float min(A a, B b) noexcept { return std::fmin(float(a), float(b)); }

template<typename A, typename B, std::enable_if_t<IsScalar<A> && IsScalar<B>, int> = 0>
inline float max(A a, B b) noexcept { return std::fmax(float(a), float(b)); }

template<typename A, typename B, typename C, std::enable_if_t<IsScalar<A> && IsScalar<B> && IsScalar<C>, int> = 0>
inline float clamp(A v, B lo, C hi) noexcept { return std::fmin(std::fmax(float(v), float(lo)), float(hi)); }

template<typename A, typename B, typename C, std::enable_if_t<IsScalar<A> && IsScalar<B> && IsScalar<C>, int> = 0>
inline float mix(A a, B b, C t) noexcept { return float(a) + (float(b) - float(a)) * float(t); }

template<typename A, typename B, std::enable_if_t<IsScalar<A> && IsScalar<B>, int> = 0>
inline float pow(A base, B power) noexcept { return std::pow(float(base), float(power)); }

template<typename A, std::enable_if_t<IsScalar<A>, int> = 0>
inline float sqrt(A v) noexcept { return std::sqrt(float(v)); }

template<typename A, std::enable_if_t<IsScalar<A>, int> = 0>
inline float abs(A v) noexcept { return std::fabs(float(v)); }

template<typename A, std::enable_if_t<IsScalar<A>, int> = 0>
inline float floor(A v) noexcept { return std::floor(float(v)); }

template<typename A, std::enable_if_t<IsScalar<A>, int> = 0>
inline float exp(A v) noexcept { return std::exp(float(v)); }

template<typename A, std::enable_if_t<IsScalar<A>, int> = 0>
inline float sin(A v) noexcept { return std::sin(float(v)); }

template<typename A, std::enable_if_t<IsScalar<A>, int> = 0>
inline float cos(A v) noexcept { return std::cos(float(v)); }

template<typename A, std::enable_if_t<IsScalar<A>, int> = 0>
inline float sign(A v) noexcept { return float(v) > 0.0f ? 1.0f : (float(v) < 0.0f ? -1.0f : 0.0f); }

inline float fract(float v) noexcept { return v - std::floor(v); }
inline float inversesqrt(float v) noexcept { return 1.0f / std::sqrt(v); }
inline float step(float edge, float v) noexcept { return v < edge ? 0.0f : 1.0f; }

template<typename A, typename B, typename C, std::enable_if_t<IsScalar<A> && IsScalar<B> && IsScalar<C>, int> = 0>
inline float smoothstep(A edge0, B edge1, C v) noexcept
{
    float t = clamp((float(v) - float(edge0)) / (float(edge1) - float(edge0)), 0.0f, 1.0f);
    return t * t * (3.0f - 2.0f * t);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                        VEC3
//------------------------------------------------------------------------------------------------------------------------

struct vec3
{
    float x = 0.0f;                                             // [-] component x
    float y = 0.0f;                                             // [-] component y
    float z = 0.0f;                                             // [-] component z

    vec3() noexcept = default;
    explicit vec3(float s) noexcept : x(s), y(s), z(s) {}
    vec3(float inX, float inY, float inZ) noexcept : x(inX), y(inY), z(inZ) {}

    vec3 operator+(const vec3& r) const noexcept { return { x + r.x, y + r.y, z + r.z }; }
    vec3 operator-(const vec3& r) const noexcept { return { x - r.x, y - r.y, z - r.z }; }
    vec3 operator*(const vec3& r) const noexcept { return { x * r.x, y * r.y, z * r.z }; }
    vec3 operator/(const vec3& r) const noexcept { return { x / r.x, y / r.y, z / r.z }; }
    template<typename S, std::enable_if_t<IsScalar<S>, int> = 0>
    vec3 operator*(S s) const noexcept { float f = float(s); return { x * f, y * f, z * f }; }
    template<typename S, std::enable_if_t<IsScalar<S>, int> = 0>
    vec3 operator/(S s) const noexcept { float f = float(s); return { x / f, y / f, z / f }; }
    vec3 operator-() const noexcept { return { -x, -y, -z }; }

    vec3& operator+=(const vec3& r) noexcept { x += r.x; y += r.y; z += r.z; return *this; }
    vec3& operator-=(const vec3& r) noexcept { x -= r.x; y -= r.y; z -= r.z; return *this; }
    template<typename S, std::enable_if_t<IsScalar<S>, int> = 0>
    vec3& operator*=(S s) noexcept { float f = float(s); x *= f; y *= f; z *= f; return *this; }
};

template<typename S, std::enable_if_t<IsScalar<S>, int> = 0>
inline vec3 operator*(S s, const vec3& v) noexcept { float f = float(s); return { v.x * f, v.y * f, v.z * f }; }
template<typename S, std::enable_if_t<IsScalar<S>, int> = 0>
inline vec3 operator/(S s, const vec3& v) noexcept { float f = float(s); return { f / v.x, f / v.y, f / v.z }; }

inline float dot(const vec3& a, const vec3& b) noexcept { return a.x * b.x + a.y * b.y + a.z * b.z; }
inline float length(const vec3& v) noexcept { return std::sqrt(dot(v, v)); }
inline vec3  normalize(const vec3& v) noexcept { float l = length(v); return l > 1e-20f ? v / l : vec3(0.0f, 0.0f, 0.0f); }
inline vec3  cross(const vec3& a, const vec3& b) noexcept
{
    return { a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x };
}
inline vec3  floor(const vec3& v) noexcept { return { std::floor(v.x), std::floor(v.y), std::floor(v.z) }; }
inline vec3  abs(const vec3& v) noexcept { return { std::fabs(v.x), std::fabs(v.y), std::fabs(v.z) }; }
inline vec3  min(const vec3& a, const vec3& b) noexcept { return { std::min(a.x, b.x), std::min(a.y, b.y), std::min(a.z, b.z) }; }
inline vec3  max(const vec3& a, const vec3& b) noexcept { return { std::max(a.x, b.x), std::max(a.y, b.y), std::max(a.z, b.z) }; }
template<typename S, std::enable_if_t<IsScalar<S>, int> = 0>
inline vec3  mix(const vec3& a, const vec3& b, S t) noexcept { return a + (b - a) * float(t); }
inline vec3  reflect(const vec3& i, const vec3& n) noexcept { return i - n * (2.0f * dot(n, i)); }
template<typename S, std::enable_if_t<IsScalar<S>, int> = 0>
inline vec3  pow(const vec3& v, S e) noexcept { float f = float(e); return { std::pow(v.x, f), std::pow(v.y, f), std::pow(v.z, f) }; }
template<typename A, typename B, std::enable_if_t<IsScalar<A> && IsScalar<B>, int> = 0>
inline vec3  clamp(const vec3& v, A lo, B hi) noexcept { return { clamp(v.x, lo, hi), clamp(v.y, lo, hi), clamp(v.z, lo, hi) }; }
inline vec3  sqrt(const vec3& v) noexcept { return { std::sqrt(v.x), std::sqrt(v.y), std::sqrt(v.z) }; }

//------------------------------------------------------------------------------------------------------------------------
//                                                        VEC2
//------------------------------------------------------------------------------------------------------------------------

struct vec2
{
    float x = 0.0f;                                             // [-] component x
    float y = 0.0f;                                             // [-] component y

    vec2() noexcept = default;
    explicit vec2(float s) noexcept : x(s), y(s) {}
    vec2(float inX, float inY) noexcept : x(inX), y(inY) {}

    vec2 operator+(const vec2& r) const noexcept { return { x + r.x, y + r.y }; }
    vec2 operator-(const vec2& r) const noexcept { return { x - r.x, y - r.y }; }
    template<typename S, std::enable_if_t<IsScalar<S>, int> = 0>
    vec2 operator*(S s) const noexcept { float f = float(s); return { x * f, y * f }; }
    template<typename S, std::enable_if_t<IsScalar<S>, int> = 0>
    vec2 operator/(S s) const noexcept { float f = float(s); return { x / f, y / f }; }
};

inline float dot(const vec2& a, const vec2& b) noexcept { return a.x * b.x + a.y * b.y; }
inline float length(const vec2& v) noexcept { return std::sqrt(dot(v, v)); }
