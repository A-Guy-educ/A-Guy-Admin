'use client'

import React from 'react'
import type { GeometrySpecV1 } from '@/infra/contracts/graphics/geometry.v1'
import { Plus, Trash2 } from 'lucide-react'

type EqualSegmentsGroup = NonNullable<GeometrySpecV1['elements']['equalSegments']>[number]
type EqualAnglesGroup = NonNullable<GeometrySpecV1['elements']['equalAngles']>[number]
type GeoPoint = GeometrySpecV1['elements']['points'][number]
type GeoAngle = GeometrySpecV1['elements']['angles'][number]

interface EqualitiesPanelProps {
  equalSegments: EqualSegmentsGroup[]
  equalAngles: EqualAnglesGroup[]
  points: GeoPoint[]
  angles: GeoAngle[]
  onEqualSegmentsChange: (groups: EqualSegmentsGroup[]) => void
  onEqualAnglesChange: (groups: EqualAnglesGroup[]) => void
}

const TICK_LABELS = ['single', 'double', 'triple', 'quadruple', 'quintuple']

const groupTickLabel = (index: number) =>
  TICK_LABELS[index] ?? `${index + 1} ticks`

const angleDisplay = (angle: GeoAngle) => `∠${angle.ray1}${angle.center}${angle.ray2}`

export const EqualitiesPanel: React.FC<EqualitiesPanelProps> = ({
  equalSegments,
  equalAngles,
  points,
  angles,
  onEqualSegmentsChange,
  onEqualAnglesChange,
}) => {
  const addSegmentGroup = () => {
    const from = points[0]?.name || ''
    const to = points[1]?.name || points[0]?.name || ''
    onEqualSegmentsChange([...equalSegments, [{ from, to }]])
  }

  const removeSegmentGroup = (groupIndex: number) => {
    onEqualSegmentsChange(equalSegments.filter((_, i) => i !== groupIndex))
  }

  const addSegmentToGroup = (groupIndex: number) => {
    const from = points[0]?.name || ''
    const to = points[1]?.name || points[0]?.name || ''
    onEqualSegmentsChange(
      equalSegments.map((g, i) => (i === groupIndex ? [...g, { from, to }] : g)),
    )
  }

  const removeSegmentFromGroup = (groupIndex: number, segIndex: number) => {
    onEqualSegmentsChange(
      equalSegments.map((g, i) => (i === groupIndex ? g.filter((_, j) => j !== segIndex) : g)),
    )
  }

  const updateSegment = (
    groupIndex: number,
    segIndex: number,
    updates: Partial<{ from: string; to: string }>,
  ) => {
    onEqualSegmentsChange(
      equalSegments.map((g, i) =>
        i === groupIndex ? g.map((s, j) => (j === segIndex ? { ...s, ...updates } : s)) : g,
      ),
    )
  }

  const addAngleGroup = () => {
    onEqualAnglesChange([...equalAngles, [0]])
  }

  const removeAngleGroup = (groupIndex: number) => {
    onEqualAnglesChange(equalAngles.filter((_, i) => i !== groupIndex))
  }

  const addAngleToGroup = (groupIndex: number) => {
    onEqualAnglesChange(
      equalAngles.map((g, i) => (i === groupIndex ? [...g, 0] : g)),
    )
  }

  const removeAngleFromGroup = (groupIndex: number, memberIndex: number) => {
    onEqualAnglesChange(
      equalAngles.map((g, i) => (i === groupIndex ? g.filter((_, j) => j !== memberIndex) : g)),
    )
  }

  const updateAngleMember = (groupIndex: number, memberIndex: number, angleIdx: number) => {
    onEqualAnglesChange(
      equalAngles.map((g, i) =>
        i === groupIndex ? g.map((v, j) => (j === memberIndex ? angleIdx : v)) : g,
      ),
    )
  }

  return (
    <div className="equalities-panel">
      <div className="panel-subsection">
        <div className="panel-subsection-header">
          <span className="panel-subsection-title">Equal Segments</span>
          <button
            type="button"
            className="panel-add-btn"
            onClick={addSegmentGroup}
            disabled={points.length < 2}
          >
            <Plus size={14} />
            <span>Add group</span>
          </button>
        </div>
        {equalSegments.length === 0 && (
          <div className="panel-empty-hint">No equal-segment groups yet.</div>
        )}
        {equalSegments.map((group, groupIndex) => (
          <div key={`seg-${groupIndex}`} className="panel-group">
            <div className="panel-group-header">
              <span className="panel-group-title">
                Group {groupIndex + 1} ({groupTickLabel(groupIndex)} tick)
              </span>
              <button
                type="button"
                className="panel-remove-btn"
                onClick={() => removeSegmentGroup(groupIndex)}
                title="Remove group"
              >
                <Trash2 size={14} />
              </button>
            </div>
            <div className="panel-items-list">
              {group.map((seg, segIndex) => (
                <div key={segIndex} className="panel-item-row">
                  <div className="panel-field">
                    <span className="panel-field-label">From</span>
                    <select
                      className="panel-field-select"
                      value={seg.from}
                      onChange={(e) => updateSegment(groupIndex, segIndex, { from: e.target.value })}
                    >
                      {points.map((p) => (
                        <option key={p.name} value={p.name}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="panel-field">
                    <span className="panel-field-label">To</span>
                    <select
                      className="panel-field-select"
                      value={seg.to}
                      onChange={(e) => updateSegment(groupIndex, segIndex, { to: e.target.value })}
                    >
                      {points.map((p) => (
                        <option key={p.name} value={p.name}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button
                    type="button"
                    className="panel-remove-btn"
                    onClick={() => removeSegmentFromGroup(groupIndex, segIndex)}
                    title="Remove segment"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              className="panel-add-btn"
              onClick={() => addSegmentToGroup(groupIndex)}
              disabled={points.length < 2}
            >
              <Plus size={14} />
              <span>Add segment</span>
            </button>
          </div>
        ))}
      </div>

      <div className="panel-subsection">
        <div className="panel-subsection-header">
          <span className="panel-subsection-title">Equal Angles</span>
          <button
            type="button"
            className="panel-add-btn"
            onClick={addAngleGroup}
            disabled={angles.length === 0}
          >
            <Plus size={14} />
            <span>Add group</span>
          </button>
        </div>
        {equalAngles.length === 0 && (
          <div className="panel-empty-hint">No equal-angle groups yet.</div>
        )}
        {equalAngles.map((group, groupIndex) => (
          <div key={`ang-${groupIndex}`} className="panel-group">
            <div className="panel-group-header">
              <span className="panel-group-title">
                Group {groupIndex + 1} ({groupTickLabel(groupIndex)} arc)
              </span>
              <button
                type="button"
                className="panel-remove-btn"
                onClick={() => removeAngleGroup(groupIndex)}
                title="Remove group"
              >
                <Trash2 size={14} />
              </button>
            </div>
            <div className="panel-items-list">
              {group.map((angleIdx, memberIndex) => (
                <div key={memberIndex} className="panel-item-row">
                  <div className="panel-field">
                    <span className="panel-field-label">Angle</span>
                    <select
                      className="panel-field-select"
                      value={angleIdx}
                      onChange={(e) =>
                        updateAngleMember(groupIndex, memberIndex, Number(e.target.value))
                      }
                    >
                      {angles.map((a, i) => (
                        <option key={i} value={i}>
                          {angleDisplay(a)}
                          {a.label?.value ? ` (${a.label.value})` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button
                    type="button"
                    className="panel-remove-btn"
                    onClick={() => removeAngleFromGroup(groupIndex, memberIndex)}
                    title="Remove angle"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              className="panel-add-btn"
              onClick={() => addAngleToGroup(groupIndex)}
              disabled={angles.length === 0}
            >
              <Plus size={14} />
              <span>Add angle</span>
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
