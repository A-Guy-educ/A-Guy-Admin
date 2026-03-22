# Mixpanel Analytics - Critical Events Specification

## Overview

Add 9 CRITICAL Mixpanel analytics events for coupon tracking, exercise quality, and engagement signals.

## Requirements

### CRITICAL - Coupon & Access Events

1. **coupon_code_entered**
   - Data: email, name, coupon_code, lesson_id, course_id, timestamp
   - Filterable by: coupon_code, is_coupon_user, email, course_id

2. **access_gate_shown**
   - Data: gate_type (free/login/paid/coupon), lesson_id, course_id
   - Filterable by: gate_type, lesson_id, course_id

3. **access_granted**
   - Data: access_type (free/coupon/paid), coupon_code, lesson_id, course_id
   - Filterable by: access_type, coupon_code, lesson_id

### CRITICAL - Exercise Quality Events

4. **answer_correct**
   - Data: exercise_id, lesson_id, time_seconds, attempt_number, difficulty_level
   - Filterable by: exercise_id, lesson_id, attempt_number, difficulty_level

5. **answer_incorrect**
   - Data: exercise_id, lesson_id, attempt_number, max_attempts, time_seconds
   - Filterable by: exercise_id, lesson_id, attempt_number

6. **exercise_skipped**
   - Data: exercise_id, lesson_id, reason
   - Filterable by: exercise_id, lesson_id, reason

### CRITICAL - Engagement Signal Events

7. **lesson_abandoned**
   - Data: lesson_id, course_id, time_spent_seconds, progress_percent, exercises_attempted, exercises_completed
   - Filterable by: lesson_id, course_id, progress_percent (ranges), time_spent_seconds (ranges)

8. **chapter_completed**
   - Data: course_id, chapter_id, total_lessons, completion_time_seconds
   - Filterable by: course_id, chapter_id

9. **time_on_page**
   - Data: page_url, time_seconds (30/60/120/300/600), scroll_depth_percent, user_interacted
   - Filterable by: time_seconds, page_url, scroll_depth_percent (ranges)

## Acceptance Criteria

- All 9 critical events are added and firing to Mixpanel
- All new events include proper filterable properties
- Can create tables filtering by all event properties
- Can build funnels using new events
- Can segment users by coupon_code, access_type, exercise performance

## Pre-Built Tables to Support

1. **Coupon Users Tracker**: email, name, coupon_code, lesson_id, date_entered, access_granted, completion_status
2. **Exercise Performance**: exercise_id, lesson_id, total_attempts, correct_count, skipped_count, avg_time_seconds, difficulty_level
3. **User Learning Journey**: email, name, courses_entered, lessons_started, lessons_completed, exercises_completed, total_help_requests, avg_attempts
4. **Engagement Signals**: email, lesson_id, time_on_lesson, progress_percent, exercises_attempted, exercises_completed, hint_used, abandoned

## Funnels to Support

- Course Access Path: page_view → access_gate_shown → access_granted → course_entered
- Exercise Completion: exercise_viewed → student_answer_submitted → (answer_correct OR answer_incorrect OR exercise_skipped)
