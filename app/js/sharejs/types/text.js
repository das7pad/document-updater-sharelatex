/* eslint-disable
    camelcase,
    no-return-assign,
    no-undef,
*/
// TODO: This file was created by bulk-decaffeinate.
// Fix any style issues and re-enable lint.
/*
 * decaffeinate suggestions:
 * DS101: Remove unnecessary use of Array.from
 * DS102: Remove unnecessary code created because of implicit returns
 * DS207: Consider shorter variations of null checks
 * Full docs: https://github.com/decaffeinate/decaffeinate/blob/master/docs/suggestions.md
 */
// A simple text implementation
//
// Operations are lists of components.
// Each component either inserts or deletes at a specified position in the document.
//
// Components are either:
//  {i:'str', p:100}: Insert 'str' at position 100 in the document
//  {d:'str', p:100}: Delete 'str' at position 100 in the document
//
// Components in an operation are executed sequentially, so the position of components
// assumes previous components have already executed.
//
// Eg: This op:
//   [{i:'abc', p:0}]
// is equivalent to this op:
//   [{i:'a', p:0}, {i:'b', p:1}, {i:'c', p:2}]

// NOTE: The global scope here is shared with other sharejs files when built with closure.
// Be careful what ends up in your namespace.

const text = {}

text.name = 'text'

const strInject = (s1, pos, s2) => s1.slice(0, pos) + s2 + s1.slice(pos)

const checkValidComponent = function (c) {
  if (typeof c.p !== 'number') {
    throw new Error('component missing position field')
  }

  const i_type = typeof c.i
  const d_type = typeof c.d
  const c_type = typeof c.c
  if (
    !((i_type === 'string') ^ (d_type === 'string') ^ (c_type === 'string'))
  ) {
    throw new Error('component needs an i, d or c field')
  }

  if (!(c.p >= 0)) {
    throw new Error('position cannot be negative')
  }
}

const checkValidOp = function (op) {
  for (const c of Array.from(op)) {
    checkValidComponent(c)
  }
  return true
}

text.apply = function (snapshot, op) {
  checkValidOp(op)
  for (const component of Array.from(op)) {
    if (component.i != null) {
      snapshot = strInject(snapshot, component.p, component.i)
    } else if (component.d != null) {
      const deleted = snapshot.slice(
        component.p,
        component.p + component.d.length
      )
      if (component.d !== deleted) {
        throw new Error(
          `Delete component '${component.d}' does not match deleted text '${deleted}'`
        )
      }
      snapshot =
        snapshot.slice(0, component.p) +
        snapshot.slice(component.p + component.d.length)
    } else if (component.c != null) {
      const comment = snapshot.slice(
        component.p,
        component.p + component.c.length
      )
      if (component.c !== comment) {
        throw new Error(
          `Comment component '${component.c}' does not match commented text '${comment}'`
        )
      }
    } else {
      throw new Error('Unknown op type')
    }
  }
  return snapshot
}

// Exported for use by the random op generator.
//
// For simplicity, this version of append does not compress adjacent inserts and deletes of
// the same text. It would be nice to change that at some stage.
function append(newOp, c) {
  if (c.i === '' || c.d === '') {
    return
  }
  if (newOp.length === 0) {
    return newOp.push(c)
  } else {
    const last = newOp[newOp.length - 1]

    // Compose the insert into the previous insert if possible
    if (
      last.i != null &&
      c.i != null &&
      last.p <= c.p &&
      c.p <= last.p + last.i.length
    ) {
      return (newOp[newOp.length - 1] = {
        i: strInject(last.i, c.p - last.p, c.i),
        p: last.p
      })
    } else if (
      last.d != null &&
      c.d != null &&
      c.p <= last.p &&
      last.p <= c.p + c.d.length
    ) {
      return (newOp[newOp.length - 1] = {
        d: strInject(c.d, last.p - c.p, last.d),
        p: c.p
      })
    } else {
      return newOp.push(c)
    }
  }
}

// This helper method transforms a position by an op component.
//
// If c is an insert, insertAfter specifies whether the transform
// is pushed after the insert (true) or before it (false).
//
// insertAfter is optional for deletes.
const transformPosition = function (pos, c, insertAfter) {
  if (c.i != null) {
    if (c.p < pos || (c.p === pos && insertAfter)) {
      return pos + c.i.length
    } else {
      return pos
    }
  } else if (c.d != null) {
    // I think this could also be written as: Math.min(c.p, Math.min(c.p - otherC.p, otherC.d.length))
    // but I think its harder to read that way, and it compiles using ternary operators anyway
    // so its no slower written like this.
    if (pos <= c.p) {
      return pos
    } else if (pos <= c.p + c.d.length) {
      return c.p
    } else {
      return pos - c.d.length
    }
  } else if (c.c != null) {
    return pos
  } else {
    throw new Error('unknown op type')
  }
}

// Transform an op component by another op component. Asymmetric.
// The result will be appended to destination.
//
// exported for use in tests
text._tc = transformComponent
function transformComponent(dest, c, otherC, side) {
  let cIntersect, intersectEnd, intersectStart, newC, otherIntersect
  checkValidComponent(c)
  checkValidComponent(otherC)

  if (c.i != null) {
    append(dest, {
      i: c.i,
      p: transformPosition(c.p, otherC, side === 'right')
    })
  } else if (c.d != null) {
    // Delete
    if (otherC.i != null) {
      // delete vs insert
      let s = c.d
      if (c.p < otherC.p) {
        append(dest, { d: s.slice(0, otherC.p - c.p), p: c.p })
        s = s.slice(otherC.p - c.p)
      }
      if (s !== '') {
        append(dest, { d: s, p: c.p + otherC.i.length })
      }
    } else if (otherC.d != null) {
      // Delete vs delete
      if (c.p >= otherC.p + otherC.d.length) {
        append(dest, { d: c.d, p: c.p - otherC.d.length })
      } else if (c.p + c.d.length <= otherC.p) {
        append(dest, c)
      } else {
        // They overlap somewhere.
        newC = { d: '', p: c.p }
        if (c.p < otherC.p) {
          newC.d = c.d.slice(0, otherC.p - c.p)
        }
        if (c.p + c.d.length > otherC.p + otherC.d.length) {
          newC.d += c.d.slice(otherC.p + otherC.d.length - c.p)
        }

        // This is entirely optional - just for a check that the deleted
        // text in the two ops matches
        intersectStart = Math.max(c.p, otherC.p)
        intersectEnd = Math.min(c.p + c.d.length, otherC.p + otherC.d.length)
        cIntersect = c.d.slice(intersectStart - c.p, intersectEnd - c.p)
        otherIntersect = otherC.d.slice(
          intersectStart - otherC.p,
          intersectEnd - otherC.p
        )
        if (cIntersect !== otherIntersect) {
          throw new Error(
            'Delete ops delete different text in the same region of the document'
          )
        }

        if (newC.d !== '') {
          // This could be rewritten similarly to insert v delete, above.
          newC.p = transformPosition(newC.p, otherC)
          append(dest, newC)
        }
      }
    } else if (otherC.c != null) {
      append(dest, c)
    } else {
      throw new Error('unknown op type')
    }
  } else if (c.c != null) {
    // Comment
    if (otherC.i != null) {
      if (c.p < otherC.p && otherC.p < c.p + c.c.length) {
        const offset = otherC.p - c.p
        const new_c =
          c.c.slice(0, +(offset - 1) + 1 || undefined) +
          otherC.i +
          c.c.slice(offset)
        append(dest, { c: new_c, p: c.p, t: c.t })
      } else {
        append(dest, {
          c: c.c,
          p: transformPosition(c.p, otherC, true),
          t: c.t
        })
      }
    } else if (otherC.d != null) {
      if (c.p >= otherC.p + otherC.d.length) {
        append(dest, { c: c.c, p: c.p - otherC.d.length, t: c.t })
      } else if (c.p + c.c.length <= otherC.p) {
        append(dest, c)
      } else {
        // Delete overlaps comment
        // They overlap somewhere.
        newC = { c: '', p: c.p, t: c.t }
        if (c.p < otherC.p) {
          newC.c = c.c.slice(0, otherC.p - c.p)
        }
        if (c.p + c.c.length > otherC.p + otherC.d.length) {
          newC.c += c.c.slice(otherC.p + otherC.d.length - c.p)
        }

        // This is entirely optional - just for a check that the deleted
        // text in the two ops matches
        intersectStart = Math.max(c.p, otherC.p)
        intersectEnd = Math.min(c.p + c.c.length, otherC.p + otherC.d.length)
        cIntersect = c.c.slice(intersectStart - c.p, intersectEnd - c.p)
        otherIntersect = otherC.d.slice(
          intersectStart - otherC.p,
          intersectEnd - otherC.p
        )
        if (cIntersect !== otherIntersect) {
          throw new Error(
            'Delete ops delete different text in the same region of the document'
          )
        }

        newC.p = transformPosition(newC.p, otherC)
        append(dest, newC)
      }
    } else if (otherC.c != null) {
      append(dest, c)
    } else {
      throw new Error('unknown op type')
    }
  }

  return dest
}

module.exports = text

// The text type really shouldn't need this - it should be possible to define
// an efficient transform function by making a sort of transform map and passing each
// op component through it.
// NOTE: Previously this line was a call into helper.js
// NOTE: As text.js is the only call-site into helper.js, the later is inlined
//        for simplicity.

// These methods let you build a transform function from a transformComponent function
// for OT types like text and JSON in which operations are lists of components
// and transforming them requires N^2 work.

// Add transform and transformX functions for an OT type which has transformComponent defined.
// transformComponent(destination array, component, other component, side)
function transformComponentX(left, right, destLeft, destRight) {
  transformComponent(destLeft, left, right, 'left')
  transformComponent(destRight, right, left, 'right')
}

// Transforms rightOp by leftOp. Returns ['rightOp', clientOp']
function transformX(leftOp, rightOp) {
  checkValidOp(leftOp)
  checkValidOp(rightOp)

  const newRightOp = []

  for (let rightComponent of rightOp) {
    // Generate newLeftOp by composing leftOp by rightComponent
    const newLeftOp = []

    let k = 0
    while (k < leftOp.length) {
      const nextC = []
      transformComponentX(leftOp[k], rightComponent, newLeftOp, nextC)
      k++

      if (nextC.length === 1) {
        rightComponent = nextC[0]
      } else if (nextC.length === 0) {
        for (const l of leftOp.slice(k)) {
          append(newLeftOp, l)
        }
        rightComponent = null
        break
      } else {
        // Recurse.
        const [l_, r_] = transformX(leftOp.slice(k), nextC)
        for (const l of l_) {
          append(newLeftOp, l)
        }
        for (const r of r_) {
          append(newRightOp, r)
        }
        rightComponent = null
        break
      }
    }

    if (rightComponent != null) {
      append(newRightOp, rightComponent)
    }
    leftOp = newLeftOp
  }

  return [leftOp, newRightOp]
}

// Transforms op with specified type ('left' or 'right') by otherOp.
text.transform = function (op, otherOp, type) {
  if (type !== 'left' && type !== 'right') {
    throw new Error("type must be 'left' or 'right'")
  }

  if (otherOp.length === 0) {
    return op
  }

  // TODO: Benchmark with and without this line. I _think_ it'll make a big difference...?
  if (op.length === 1 && otherOp.length === 1) {
    return transformComponent([], op[0], otherOp[0], type)
  }

  if (type === 'left') {
    const [left] = transformX(op, otherOp)
    return left
  } else {
    const [, right] = transformX(otherOp, op)
    return right
  }
}
