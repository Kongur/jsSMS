/**
 * jsSMS - A Sega Master System/Game Gear emulator in JavaScript
 * Copyright (C) 2012  Guillaume Marty (https://github.com/gmarty)
 * Based on JavaGear Copyright (c) 2002-2008 Chris White
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

'use strict';

/** @const */ var UINT8 = 1;
/** @const */ var INT8 = 2;
/** @const */ var UINT16 = 3;

var BIT_TABLE = [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80];


// List of high level node types. Think of it as basic blocks of AST.
/** @struct */
var n = {
  IfStatement: function(test, consequent, alternate) {
    if (alternate == undefined) alternate = null;
    return {
      'type': 'IfStatement',
      'test': test,
      'consequent': consequent,
      'alternate': alternate
    };
  },
  BlockStatement: function(body) {
    if (body == undefined) body = [];
    if (!Array.isArray(body)) body = [body];
    return {
      'type': 'BlockStatement',
      'body': body
    };
  },
  ExpressionStatement: function(expression) {
    return {
      'type': 'ExpressionStatement',
      'expression': expression
    };
  },
  ReturnStatement: function(argument) {
    if (argument == undefined) argument = null;
    return {
      'type': 'ReturnStatement',
      'argument': argument
    };
  },
  VariableDeclaration: function(name, init) {
    return {
      'type': 'VariableDeclaration',
      'declarations': [
        {
          'type': 'VariableDeclarator',
          'id': {
            'type': 'Identifier',
            'name': name
          },
          'init': init
        }
      ],
      'kind': 'var'
    };
  },
  Identifier: function(name) {
    return {
      'type': 'Identifier',
      'name': name
    };
  },
  Literal: function(value) {
    if (DEBUG && typeof value == 'number') {
      return {
        'type': 'Literal',
        'value': value,
        'raw': JSSMS.Utils.toHex(value)
      };
    } else {
      return {
        'type': 'Literal',
        'value': value
      };
    }
  },
  CallExpression: function(callee, args) {
    if (args == undefined) args = [];
    if (!Array.isArray(args)) args = [args];
    return {
      'type': 'CallExpression',
      'callee': n.Identifier(callee),
      'arguments': args
    };
  },
  AssignmentExpression: function(operator, left, right) {
    return {
      'type': 'AssignmentExpression',
      'operator': operator,
      'left': left,
      'right': right
    };
  },
  BinaryExpression: function(operator, left, right) {
    return {
      'type': 'BinaryExpression',
      'operator': operator,
      'left': left,
      'right': right
    };
  },
  UnaryExpression: function(operator, argument) {
    return {
      'type': 'UnaryExpression',
      'operator': operator,
      'argument': argument
    };
  },
  MemberExpression: function(object, property) {
    return {
      'type': 'MemberExpression',
      'computed': true, // Generate `object[property]`.
      'object': object,
      'property': property
    };
  },
  ConditionalExpression: function(test, consequent, alternate) {
    return {
      'type': 'ConditionalExpression',
      'test': test,
      'consequent': consequent,
      'alternate': alternate
    };
  },
  LogicalExpression: function(operator, left, right) {
    return {
      'type': 'LogicalExpression',
      'operator': operator,
      'left': left,
      'right': right
    };
  },
  // This is not a real AST block, but it's convenient for manipulating registers in optimizer.
  Register: function(name) {
    return {
      'type': 'Register',
      'name': name
    };
  },
  Bit: function(bitNumber) {
    return n.Literal(BIT_TABLE[bitNumber]);
  }
};


// List of common operations for the Z80.
// Each entry returns a function accepting an optional parameter.
var o = {
  // Helper function for setting 2 registers at the same time.
  SET16: function(register1, register2, value) {
    if (value.type == 'Literal') {
      // We can evaluate the expression:
      // h = 0x00;
      // l = 0xFF;
      var hi = evaluate(n.BinaryExpression('>>', value, n.Literal(8)));
      var lo = evaluate(n.BinaryExpression('&', value, n.Literal(0xFF)));
      return [
        n.ExpressionStatement(n.AssignmentExpression('=', n.Register(register1), hi)),
        n.ExpressionStatement(n.AssignmentExpression('=', n.Register(register2), lo))
      ];
    } else {
      // We can't evaluate the expression: it will be done at runtime:
      // var val = value;
      // h = value >> 8;
      // l = value & 0xFF;
      return [
        n.VariableDeclaration('val', value),
        n.ExpressionStatement(n.AssignmentExpression('=', n.Register(register1), n.BinaryExpression('>>', n.Identifier('val'), n.Literal(8)))),
        n.ExpressionStatement(n.AssignmentExpression('=', n.Register(register2), n.BinaryExpression('&', n.Identifier('val'), n.Literal(0xFF))))
      ];
    }
  },
  EX: function(register1, register2) {
    // temp = a;
    // a = a2;
    // a2 = temp;
    // temp = f;
    // f = f2;
    // f2 = temp;
    return [
      n.ExpressionStatement(n.AssignmentExpression('=', n.Identifier('temp'), n.Register(register1))),
      n.ExpressionStatement(n.AssignmentExpression('=', n.Register(register1), n.Identifier(register1 + '2'))),
      n.ExpressionStatement(n.AssignmentExpression('=', n.Identifier(register1 + '2'), n.Identifier('temp'))),
      n.ExpressionStatement(n.AssignmentExpression('=', n.Identifier('temp'), n.Register(register2))),
      n.ExpressionStatement(n.AssignmentExpression('=', n.Register(register2), n.Identifier(register2 + '2'))),
      n.ExpressionStatement(n.AssignmentExpression('=', n.Identifier(register2 + '2'), n.Identifier('temp')))
    ];
  },
  NOOP: function() {
    return function() {
      return;
    }
  },
  LD8: function(srcRegister, dstRegister1, dstRegister2) {
    if (dstRegister1 == undefined && dstRegister2 == undefined)
      // Direct value assignment (ex: `LD B,n`).
      return function(value) {
        return n.ExpressionStatement(
            n.AssignmentExpression('=', n.Register(srcRegister), n.Literal(value))
        );
      };
    if (dstRegister1 == 'i' && dstRegister2 == undefined)
      // a = i;
      // f = (f & F_CARRY) | SZ_TABLE[a] | (iff2 ? F_PARITY : 0);
      return function() {
        return [
          n.ExpressionStatement(n.AssignmentExpression('=',
              n.Register(srcRegister),
              n.Register('i')
              )),
          n.ExpressionStatement(n.AssignmentExpression('=', n.Register('f'),
              n.BinaryExpression('|',
              n.BinaryExpression('|',
                n.BinaryExpression('&', n.Register('f'), n.Literal(F_CARRY)),
                n.MemberExpression(n.Identifier('SZ_TABLE'), n.Register(srcRegister))
              ),
              n.ConditionalExpression(n.Identifier('iff2'), n.Literal(F_PARITY), n.Literal(0))
              )))
        ];
      };
    if (dstRegister1 == 'r' && dstRegister2 == undefined)
      // a = REFRESH_EMULATION ? r : JSSMS.Utils.rndInt(255);
      // f = (f & F_CARRY) | SZ_TABLE[a] | (iff2 ? F_PARITY : 0);
      return function() {
        return [
          n.ExpressionStatement(n.AssignmentExpression('=',
              n.Register(srcRegister),
              REFRESH_EMULATION ? n.Register('r') : n.CallExpression('JSSMS.Utils.rndInt', n.Literal(255))
              )),
          n.ExpressionStatement(n.AssignmentExpression('=', n.Register('f'),
              n.BinaryExpression('|',
              n.BinaryExpression('|',
                n.BinaryExpression('&', n.Register('f'), n.Literal(F_CARRY)),
                n.MemberExpression(n.Identifier('SZ_TABLE'), n.Register(srcRegister))
              ),
              n.ConditionalExpression(n.Identifier('iff2'), n.Literal(F_PARITY), n.Literal(0))
              )))
        ];
      };
    if (dstRegister2 == undefined)
      // Register assignment (ex: `LD B,C`).
      return function() {
        return n.ExpressionStatement(
            n.AssignmentExpression('=', n.Register(srcRegister), n.Register(dstRegister1))
        );
      };
    if (dstRegister1 == 'n' && dstRegister2 == 'n')
      // Direct address value assignment (ex: `LD A,(nn)`).
      return function(value) {
        return n.ExpressionStatement(
            n.AssignmentExpression('=', n.Register(srcRegister), o.READ_MEM8(n.Literal(value)))
        );
      };
    else
      // Register address value assignment (ex: `LD A,(BC)`).
      return function() {
        return n.ExpressionStatement(
            n.AssignmentExpression('=', n.Register(srcRegister),
            o.READ_MEM8(n.CallExpression('get' + (dstRegister1 + dstRegister2).toUpperCase()))
            )
        );
      };
  },
  LD8_D: function(srcRegister, dstRegister1, dstRegister2) {
    // a = readMem(getIXHIXL() + value);
    return function(value) {
      return n.ExpressionStatement(
          n.AssignmentExpression('=',
          n.Register(srcRegister),
          o.READ_MEM8(n.BinaryExpression('+', n.CallExpression('get' + (dstRegister1 + dstRegister2).toUpperCase()),
          n.Literal(value)))
          )
      );
    };
  },
  LD16: function(srcRegister1, srcRegister2, dstRegister1, dstRegister2) {
    if (dstRegister1 == undefined && dstRegister2 == undefined)
      // Direct value assignment (ex: `LD HL,nn`).
      return function(value) {
        return o.SET16(srcRegister1, srcRegister2, n.Literal(value));
      };
    if (dstRegister1 == 'n' && dstRegister2 == 'n')
      // Direct address value assignment (ex: `LD HL,(nn)`).
      return function(value) {
        return o.SET16(srcRegister1, srcRegister2, o.READ_MEM16(n.Literal(value)));
      };
    else
      throw Error('Wrong parameters number');
  },
  LD_WRITE_MEM: function(srcRegister1, srcRegister2, dstRegister1, dstRegister2) {
    if (dstRegister1 == undefined && dstRegister2 == undefined)
      // Direct value assignment (ex: `LD (HL),n`).
      return function(value) {
        return n.ExpressionStatement(
            n.CallExpression('writeMem', [n.CallExpression('get' + (srcRegister1 + srcRegister2).toUpperCase()), n.Literal(value)])
        );
      };
    if (srcRegister1 == 'n' && srcRegister2 == 'n' && dstRegister2 == undefined)
      // Direct address assignment (ex: `LD (nn),A`).
      return function(value) {
        return n.ExpressionStatement(
            n.CallExpression('writeMem', [n.Literal(value), n.Register(dstRegister1)])
        );
      };
    if (srcRegister1 == 'n' && srcRegister2 == 'n')
      // Direct address assignment (ex: `LD (nn),HL`).
      return function(value) {
        return [
          n.ExpressionStatement(
              n.CallExpression('writeMem', [n.Literal(value), n.Register(dstRegister2)])
          ),
          n.ExpressionStatement(
              n.CallExpression('writeMem', [n.Literal(value + 1), n.Register(dstRegister1)])
          )
        ];
      };
    else
      // Register assignment (ex: `LD (BC),a`).
      return function() {
        return n.ExpressionStatement(
            n.CallExpression('writeMem', [n.CallExpression('get' + (srcRegister1 + srcRegister2).toUpperCase()), n.Register(dstRegister1)])
        );
      };
  },
  LD_SP: function(register1, register2) {
    if (register1 == undefined && register2 == undefined)
      // sp = value;
      return function(value) {
        return n.ExpressionStatement(
            n.AssignmentExpression('=', n.Identifier('sp'), n.Literal(value))
        );
      };
    else
      // sp = getHL();
      return function() {
        return n.ExpressionStatement(
            n.AssignmentExpression('=', n.Identifier('sp'), n.CallExpression('get' + (register1 + register2).toUpperCase()))
        );
      };
  },
  LD_NN: function(register1, register2) {
    if (register2 == undefined)
      // writeMem(value, sp & 0xFF);
      // writeMem(value + 1, sp >> 8);
      return function(value) {
        return [
          n.ExpressionStatement(n.CallExpression('writeMem',
              n.Literal(value),
              n.BinaryExpression('&', n.Identifier(register1), n.Literal(0xFF))
              )),
          n.ExpressionStatement(n.CallExpression('writeMem',
              n.Literal(value + 1),
              n.BinaryExpression('>>', n.Identifier(register1), n.Literal(8))
              ))
        ];
      };
    else
      // writeMem(value, c);
      // writeMem(value + 1, b);
      return function(value) {
        return [
          n.ExpressionStatement(n.CallExpression('writeMem',
              [n.Literal(value), n.Register(register2)])
          ),
          n.ExpressionStatement(n.CallExpression('writeMem',
              [n.Literal(value + 1),
               n.Register(register1)]
              ))
        ];
      };
  },
  INC8: function(register1, register2) {
    if (register2 == undefined)
      return function() {
        // b = inc8(b);
        return n.ExpressionStatement(
            n.AssignmentExpression('=', n.Register(register1), n.CallExpression('inc8', n.Register(register1)))
        );
      };
    if (register1 == 's' && register2 == 'p')
      return function() {
        // sp = sp + 1;
        return n.ExpressionStatement(
            n.AssignmentExpression('=', n.Identifier('sp'), n.BinaryExpression('+', n.Identifier('sp'), n.Literal(1)))
        );
      };
    else
      return function() {
        // incMem(getHL());
        return n.ExpressionStatement(
            n.CallExpression('incMem', n.CallExpression('getHL'))
        );
      };
  },
  INC16: function(register1, register2) {
    return function() {
      // c = (c + 1) & 0xFF;
      // if (c == 0) {
      //   b = (b + 1) & 0xFF;
      // }
      return [
        n.ExpressionStatement(
            n.AssignmentExpression('=', n.Register(register2), n.BinaryExpression('&', n.BinaryExpression('+', n.Register(register2), n.Literal(1)), n.Literal(0xFF)))
        ),
        n.IfStatement(
            n.BinaryExpression('==', n.Register(register2), n.Literal(0)),
            n.BlockStatement([
              n.ExpressionStatement(
                n.AssignmentExpression('=', n.Register(register1), n.BinaryExpression('&', n.BinaryExpression('+', n.Register(register1), n.Literal(1)), n.Literal(0xFF)))
              )
            ])
        )
      ];
    };
  },
  DEC8: function(register1, register2) {
    if (register2 == undefined)
      return function() {
        // b = dec8(b);
        return n.ExpressionStatement(
            n.AssignmentExpression('=', n.Register(register1), n.CallExpression('dec8', n.Register(register1)))
        );
      };
    if (register1 == 's' && register2 == 'p')
      return function() {
        // sp = sp - 1;
        return n.ExpressionStatement(
            n.AssignmentExpression('=', n.Identifier('sp'), n.BinaryExpression('-', n.Identifier('sp'), n.Literal(1)))
        );
      };
    else
      return function() {
        // decMem(getHL());
        return n.ExpressionStatement(
            n.CallExpression('decMem', n.CallExpression('getHL'))
        );
      };
  },
  DEC16: function(register1, register2) {
    return function() {
      // c = (c - 1) & 0xFF;
      // if (c == 255) {
      //   b = (b - 1) & 0xFF;
      // }
      return [
        n.ExpressionStatement(
            n.AssignmentExpression('=', n.Register(register2), n.BinaryExpression('&', n.BinaryExpression('-', n.Register(register2), n.Literal(1)), n.Literal(0xFF)))
        ),
        n.IfStatement(
            n.BinaryExpression('==', n.Register(register2), n.Literal(255)),
            n.BlockStatement([
              n.ExpressionStatement(
                n.AssignmentExpression('=', n.Register(register1), n.BinaryExpression('&', n.BinaryExpression('-', n.Register(register1), n.Literal(1)), n.Literal(0xFF)))
              )
            ])
        )
      ];
    };
  },
  ADD16: function(register1, register2, register3, register4) {
    if (register4 == undefined)
      return function() {
        // setHL(add16(getHL(), sp));
        return o.SET16(register1, register2, n.CallExpression('add16',
            [n.CallExpression('get' + (register1 + register2).toUpperCase()),
             n.Register(register3)]
            ));
      };
    else
      return function() {
        // setHL(add16(getHL(), getBC()));
        return o.SET16(register1, register2, n.CallExpression('add16',
            [n.CallExpression('get' + (register1 + register2).toUpperCase()),
             n.CallExpression('get' + (register3 + register4).toUpperCase())]
            ));
      };
  },
  RLCA: function() {
    return function() {
      return n.ExpressionStatement(
          n.CallExpression('rlca_a')
      );
    };
  },
  RRCA: function() {
    return function() {
      return n.ExpressionStatement(
          n.CallExpression('rrca_a')
      );
    };
  },
  RLA: function() {
    return function() {
      return n.ExpressionStatement(
          n.CallExpression('rla_a')
      );
    };
  },
  RRA: function() {
    return function() {
      return n.ExpressionStatement(
          n.CallExpression('rra_a')
      );
    };
  },
  DAA: function() {
    return function() {
      return n.ExpressionStatement(
          n.CallExpression('daa')
      );
    };
  },
  CPL: function() {
    return function() {
      return n.ExpressionStatement(
          n.CallExpression('cpl_a')
      );
    };
  },
  SCF: function() {
    return function() {
      // f |= F_CARRY;
      // f &= ~ F_NEGATIVE;
      // f &= ~ F_HALFCARRY;
      return [
        n.ExpressionStatement(n.AssignmentExpression('|=', n.Register('f'), n.Literal(F_CARRY))),
        n.ExpressionStatement(n.AssignmentExpression('&=', n.Register('f'), n.UnaryExpression('~', n.Literal(F_NEGATIVE)))),
        n.ExpressionStatement(n.AssignmentExpression('&=', n.Register('f'), n.UnaryExpression('~', n.Literal(F_HALFCARRY))))
      ];
    };
  },
  CCF: function() {
    return function() {
      return n.ExpressionStatement(
          n.CallExpression('ccf')
      );
    };
  },
  ADD: function(register1, register2) {
    if (register1 == undefined && register2 == undefined)
      return function(value) {
        // add_a(value);
        return n.ExpressionStatement(
            n.CallExpression('add_a', n.Literal(value))
        );
      };
    if (register2 == undefined)
      return function() {
        // add_a(b);
        return n.ExpressionStatement(
            n.CallExpression('add_a', n.Register(register1))
        );
      };
    else
      return function() {
        // add_a(readMem(getHL()));
        return n.ExpressionStatement(
            n.CallExpression('add_a', o.READ_MEM8(n.CallExpression('get' + (register1 + register2).toUpperCase())))
        );
      };
  },
  ADC: function(register1, register2) {
    if (register1 == undefined && register2 == undefined)
      return function(value) {
        // adc_a(value);
        return n.ExpressionStatement(
            n.CallExpression('adc_a', n.Literal(value))
        );
      };
    if (register2 == undefined)
      return function() {
        // adc_a(b);
        return n.ExpressionStatement(
            n.CallExpression('adc_a', n.Register(register1))
        );
      };
    else
      return function() {
        // adc_a(readMem(getHL()));
        return n.ExpressionStatement(
            n.CallExpression('adc_a', o.READ_MEM8(n.CallExpression('get' + (register1 + register2).toUpperCase())))
        );
      };
  },
  SUB: function(register1, register2) {
    if (register1 == undefined && register2 == undefined)
      return function(value, target, nextAddress) {
        // sub_a(value);
        return n.ExpressionStatement(
            n.CallExpression('sub_a', n.Literal(value))
        );
      };
    if (register2 == undefined)
      return function() {
        // sub_a(b);
        return n.ExpressionStatement(
            n.CallExpression('sub_a', n.Register(register1))
        );
      };
    else
      return function() {
        // sub_a(readMem(getHL()));
        return n.ExpressionStatement(
            n.CallExpression('sub_a', o.READ_MEM8(n.CallExpression('get' + (register1 + register2).toUpperCase())))
        );
      };
  },
  SBC: function(register1, register2) {
    if (register1 == undefined && register2 == undefined)
      return function(value, target, nextAddress) {
        // sbc_a(value);
        return n.ExpressionStatement(
            n.CallExpression('sbc_a', n.Literal(value))
        );
      };
    if (register2 == undefined)
      return function() {
        // sbc_a(b);
        return n.ExpressionStatement(
            n.CallExpression('sbc_a', n.Register(register1))
        );
      };
    else
      return function() {
        // sbc_a(readMem(getHL()));
        return n.ExpressionStatement(
            n.CallExpression('sbc_a', o.READ_MEM8(n.CallExpression('get' + (register1 + register2).toUpperCase())))
        );
      };
  },
  AND: function(register1, register2) {
    if (register1 == undefined && register2 == undefined)
      return function(value, target, nextAddress) {
        // a &= value;
        // f = SZP_TABLE[a] | F_HALFCARRY;
        return [
          n.ExpressionStatement(
              n.AssignmentExpression('&=', n.Register('a'), n.Literal(value))
          ),
          n.ExpressionStatement(
              n.AssignmentExpression('=', n.Register('f'),
              n.BinaryExpression('|', n.MemberExpression(n.Identifier('SZP_TABLE'), n.Register('a')),
                n.Literal(F_HALFCARRY)
              )
              )
          )
        ];
      };
    if (register1 != 'a' && register2 == undefined)
      return function() {
        // a &= b;
        // f = SZP_TABLE[a] | F_HALFCARRY;
        return [
          n.ExpressionStatement(
              n.AssignmentExpression('&=', n.Register('a'), n.Register(register1))
          ),
          n.ExpressionStatement(
              n.AssignmentExpression('=', n.Register('f'),
              n.BinaryExpression('|', n.MemberExpression(n.Identifier('SZP_TABLE'), n.Register('a')),
                n.Literal(F_HALFCARRY)
              )
              )
          )
        ];
      };
    if (register1 == 'a' && register2 == undefined)
      return function() {
        // f = SZP_TABLE[a] | F_HALFCARRY;
        return n.ExpressionStatement(
            n.AssignmentExpression('=', n.Register('f'),
            n.BinaryExpression('|', n.MemberExpression(n.Identifier('SZP_TABLE'), n.Register('a')),
            n.Literal(F_HALFCARRY)
            )
            )
        );
      };
    else
      return function() {
        return [
          // a &= readMem(getHL());
          // f = SZP_TABLE[a] | F_HALFCARRY;
          n.ExpressionStatement(
              n.AssignmentExpression('&=', n.Register('a'), o.READ_MEM8(n.CallExpression('get' + (register1 + register2).toUpperCase())))
          ),
          n.ExpressionStatement(
              n.AssignmentExpression('=', n.Register('f'),
              n.BinaryExpression('|', n.MemberExpression(n.Identifier('SZP_TABLE'), n.Register('a')),
                n.Literal(F_HALFCARRY)
              )
              )
          )
        ];
      }
  },
  XOR: function(register1, register2) {
    if (register1 == undefined && register2 == undefined)
      return function(value, target, nextAddress) {
        // a ^= value;
        // f = SZP_TABLE[a];
        return [
          n.ExpressionStatement(
              n.AssignmentExpression('^=', n.Register('a'), n.Literal(value))
          ),
          n.ExpressionStatement(
              n.AssignmentExpression('=', n.Register('f'),
              n.MemberExpression(n.Identifier('SZP_TABLE'), n.Register('a'))
              )
          )
        ];
      };
    if (register1 != 'a' && register2 == undefined)
      return function() {
        // a ^= b;
        // f = SZP_TABLE[a];
        return [
          n.ExpressionStatement(
              n.AssignmentExpression('^=', n.Register('a'), n.Register(register1))
          ),
          n.ExpressionStatement(
              n.AssignmentExpression('=', n.Register('f'),
              n.MemberExpression(n.Identifier('SZP_TABLE'), n.Register('a'))
              )
          )
        ];
      };
    if (register1 == 'a' && register2 == undefined)
      return function() {
        // a = 0;
        // f = SZP_TABLE[0];
        return [
          n.ExpressionStatement(
              n.AssignmentExpression('=', n.Register('a'), n.Literal(0))
          ),
          n.ExpressionStatement(
              // @todo Find a better way of calling `SZP_TABLE` than `sms.cpu.SZP_TABLE`.
              //n.AssignmentExpression('=', n.Register('f'), n.Literal(sms.cpu.SZP_TABLE[0]))
              n.AssignmentExpression('=', n.Register('f'), n.MemberExpression(n.Identifier('SZP_TABLE'), n.Literal(0)))
          )
        ];
      };
    else
      return function() {
        // a ^= readMem(getHL());
        // f = SZP_TABLE[a];
        return [
          n.ExpressionStatement(
              n.AssignmentExpression('^=', n.Register('a'), o.READ_MEM8(n.CallExpression('get' + (register1 + register2).toUpperCase())))
          ),
          n.ExpressionStatement(
              n.AssignmentExpression('=', n.Register('f'),
              n.MemberExpression(n.Identifier('SZP_TABLE'), n.Register('a'))
              )
          )
        ];
      };
  },
  OR: function(register1, register2) {
    if (register1 == undefined && register2 == undefined)
      return function(value, target, nextAddress) {
        // a |= value;
        // f = SZP_TABLE[a];
        return [
          n.ExpressionStatement(
              n.AssignmentExpression('|=', n.Register('a'), n.Literal(value))
          ),
          n.ExpressionStatement(
              n.AssignmentExpression('=', n.Register('f'),
              n.MemberExpression(n.Identifier('SZP_TABLE'), n.Register('a'))
              )
          )
        ];
      };
    if (register1 != 'a' && register2 == undefined)
      return function() {
        // a |= b;
        // f = SZP_TABLE[a];
        return [
          n.ExpressionStatement(
              n.AssignmentExpression('|=', n.Register('a'), n.Register(register1))
          ),
          n.ExpressionStatement(
              n.AssignmentExpression('=', n.Register('f'),
              n.MemberExpression(n.Identifier('SZP_TABLE'), n.Register('a'))
              )
          )
        ];
      };
    if (register1 == 'a' && register2 == undefined)
      return function() {
        // f = SZP_TABLE[a];
        return n.ExpressionStatement(
            n.AssignmentExpression('=', n.Register('f'),
            n.MemberExpression(n.Identifier('SZP_TABLE'), n.Register('a'))
            )
        );
      };
    else
      return function() {
        // a |= readMem(getHL());
        // f = SZP_TABLE[a];
        return [
          n.ExpressionStatement(
              n.AssignmentExpression('|=', n.Register('a'), o.READ_MEM8(n.CallExpression('get' + (register1 + register2).toUpperCase())))
          ),
          n.ExpressionStatement(
              n.AssignmentExpression('=', n.Register('f'),
              n.MemberExpression(n.Identifier('SZP_TABLE'), n.Register('a'))
              )
          )
        ];
      };
  },
  CP: function(register1, register2) {
    if (register1 == undefined && register2 == undefined)
      return function(value) {
        // cp_a(value);
        return n.ExpressionStatement(
            n.CallExpression('cp_a', n.Literal(value))
        );
      };
    if (register2 == undefined)
      return function() {
        // cp_a(b);
        return n.ExpressionStatement(
            n.CallExpression('cp_a', n.Register(register1))
        );
      };
    else
      return function() {
        // cp_a(readMem(getHL()));
        return n.ExpressionStatement(
            n.CallExpression('cp_a', o.READ_MEM8(n.CallExpression('get' + (register1 + register2).toUpperCase())))
        );
      };
  },
  POP: function(register1, register2) {
    return function() {
      // setBC(readMemWord(sp));
      // sp += 2;
      return [].concat(
          o.SET16(register1, register2, o.READ_MEM16(n.Identifier('sp'))),
          n.ExpressionStatement(n.AssignmentExpression('+=', n.Identifier('sp'), n.Literal(2)))
      );
    };
  },
  PUSH: function(register1, register2) {
    return function() {
      // push2(b, c);
      return n.ExpressionStatement(
          n.CallExpression('push2', [n.Register(register1), n.Register(register2)])
      );
    };
  },
  JR: function(test) {
    return function(value, target) {
      // if (test) {
      //   tstates -= 5;
      //   pc = target + (page * 0x4000);
      // }
      return n.IfStatement(
          test,
          n.BlockStatement([
            n.ExpressionStatement(n.AssignmentExpression('-=', n.Identifier('tstates'), n.Literal(5))),
            n.ExpressionStatement(n.AssignmentExpression('=', n.Identifier('pc'), n.BinaryExpression('+',
                n.Literal(target % 0x4000), n.BinaryExpression('*',
                n.Identifier('page'), n.Literal(0x4000)
                )))),
            n.ReturnStatement()
          ])
      );
    };
  },
  DJNZ: function() {
    return function(value, target) {
      // b = (b - 1) & 0xFF;
      // if (b != 0) {
      //   tstates -= 5;
      //   pc = target;
      // }
      return [
        n.ExpressionStatement(
            n.AssignmentExpression('=', n.Register('b'), n.BinaryExpression('&', n.BinaryExpression('-', n.Register('b'), n.Literal(1)), n.Literal(0xFF)))
        ),
        o.JR(n.BinaryExpression('!=', n.Register('b'), n.Literal(0)))(undefined, target)
      ];
    };
  },
  JRNZ: function() {
    return function(value, target) {
      // jr(!((f & F_ZERO) != 0));
      return o.JR(n.UnaryExpression('!',
          n.BinaryExpression('!=',
          n.BinaryExpression('&', n.Register('f'), n.Literal(F_ZERO)),
          n.Literal(0))))(undefined, target);
    };
  },
  JRZ: function() {
    return function(value, target) {
      // jr((f & F_ZERO) != 0);
      return o.JR(n.BinaryExpression('!=',
          n.BinaryExpression('&', n.Register('f'), n.Literal(F_ZERO)),
          n.Literal(0)))(undefined, target);
    };
  },
  JRNC: function() {
    return function(value, target) {
      // jr(!((f & F_CARRY) != 0));
      return o.JR(n.UnaryExpression('!',
          n.BinaryExpression('!=',
          n.BinaryExpression('&', n.Register('f'), n.Literal(F_CARRY)),
          n.Literal(0))))(undefined, target);
    };
  },
  JRC: function() {
    return function(value, target) {
      // jr((f & F_CARRY) != 0);
      return o.JR(n.BinaryExpression('!=',
          n.BinaryExpression('&', n.Register('f'), n.Literal(F_CARRY)),
          n.Literal(0)))(undefined, target);
    };
  },
  RET: function(operator, bitMask) {
    if (operator == undefined && bitMask == undefined)
      return function() {
        // pc = readMemWord(sp);
        // sp += 2;
        // return;
        return [
          n.ExpressionStatement(n.AssignmentExpression('=', n.Identifier('pc'), o.READ_MEM16(n.Identifier('sp')))),
          n.ExpressionStatement(n.AssignmentExpression('+=', n.Identifier('sp'), n.Literal(2))),
          n.ReturnStatement()
        ];
      };
    else
      return function(value, target, nextAddress) {
        // if ((f & F_ZERO) == 0) {
        //   tstates -= 6;
        //   pc = readMemWord(sp);
        //   sp += 2;
        //   return;
        // }
        return n.IfStatement(
            n.BinaryExpression(operator, n.BinaryExpression('&', n.Register('f'), n.Literal(bitMask)), n.Literal(0)),
            n.BlockStatement([
              n.ExpressionStatement(n.AssignmentExpression('-=', n.Identifier('tstates'), n.Literal(6))),
              n.ExpressionStatement(n.AssignmentExpression('=', n.Identifier('pc'), o.READ_MEM16(n.Identifier('sp')))),
              n.ExpressionStatement(n.AssignmentExpression('+=', n.Identifier('sp'), n.Literal(2))),
              n.ReturnStatement()
            ])
        );
      };
  },
  JP: function(operator, bitMask) {
    if (operator == undefined && bitMask == undefined)
      return function(value, target, nextAddress) {
        // pc = readMemWord(target);
        // return;
        return [
          n.ExpressionStatement(n.AssignmentExpression('=', n.Identifier('pc'), n.Literal(target))),
          n.ReturnStatement()
        ];
      };
    if (operator == 'h' && bitMask == 'l')
      return function(value, target, nextAddress) {
        // pc = getHL();
        // return;
        return [
          n.ExpressionStatement(n.AssignmentExpression('=', n.Identifier('pc'), n.CallExpression('get' + ('h' + 'l').toUpperCase()))),
          n.ReturnStatement()
        ];
      };
    else
      return function(value, target) {
        // if ((f & F_SIGN) != 0) {
        //   pc = target;
        //   return;
        // }
        return n.IfStatement(
            n.BinaryExpression(operator,
            n.BinaryExpression('&', n.Register('f'), n.Literal(bitMask)),
            n.Literal(0)
            ),
            n.BlockStatement([
              n.ExpressionStatement(n.AssignmentExpression('=', n.Identifier('pc'), n.Literal(target))),
              n.ReturnStatement()
            ])
        );
      };
  },
  CALL: function(operator, bitMask) {
    if (operator == undefined && bitMask == undefined)
      return function(value, target, nextAddress) {
        // push1(nextAddress + (page * 0x4000));
        // pc = target;
        // return;
        return [
          n.ExpressionStatement(n.CallExpression('push1', n.BinaryExpression('+',
              n.Literal(nextAddress % 0x4000), n.BinaryExpression('*',
              n.Identifier('page'), n.Literal(0x4000)
              ))
              )),
          n.ExpressionStatement(n.AssignmentExpression('=', n.Identifier('pc'), n.Literal(target))),
          n.ReturnStatement()
        ];
      };
    else
      return function(value, target, nextAddress) {
        // if ((f & F_ZERO) == 0) {
        //   push1(nextAddress + (page * 0x4000));
        //   tstates -= 7;
        //   pc = target;
        //   return;
        // }
        return n.IfStatement(
            n.BinaryExpression(operator,
            n.BinaryExpression('&', n.Register('f'), n.Literal(bitMask)),
            n.Literal(0)
            ),
            n.BlockStatement([
              n.ExpressionStatement(n.AssignmentExpression('-=', n.Identifier('tstates'), n.Literal(7))),
              n.ExpressionStatement(n.CallExpression('push1', n.BinaryExpression('+',
                  n.Literal(nextAddress % 0x4000), n.BinaryExpression('*',
                  n.Identifier('page'), n.Literal(0x4000)
                  ))
                  )),
              n.ExpressionStatement(n.AssignmentExpression('=', n.Identifier('pc'), n.Literal(target))),
              n.ReturnStatement()
            ])
        );
      };
  },
  RST: function(targetAddress) {
    return function(value, target, nextAddress) {
      // push1(nextAddress + (page * 0x4000));
      // pc = target;
      // return;
      return [
        n.ExpressionStatement(n.CallExpression('push1', n.BinaryExpression('+',
            n.Literal(nextAddress % 0x4000), n.BinaryExpression('*',
            n.Identifier('page'), n.Literal(0x4000)
            ))
            )),
        n.ExpressionStatement(n.AssignmentExpression('=', n.Identifier('pc'), n.Literal(targetAddress))),
        n.ReturnStatement()
      ];
    };
  },
  DI: function() {
    return function() {
      // iff1 = false;
      // iff2 = false;
      // EI_inst = true;
      return [
        n.ExpressionStatement(n.AssignmentExpression('=', n.Identifier('iff1'), n.Literal(false))),
        n.ExpressionStatement(n.AssignmentExpression('=', n.Identifier('iff2'), n.Literal(false))),
        n.ExpressionStatement(n.AssignmentExpression('=', n.Identifier('EI_inst'), n.Literal(true)))
      ];
    };
  },
  EI: function() {
    return function() {
      // iff1 = true;
      // iff2 = true;
      // EI_inst = true;
      return [
        n.ExpressionStatement(n.AssignmentExpression('=', n.Identifier('iff1'), n.Literal(true))),
        n.ExpressionStatement(n.AssignmentExpression('=', n.Identifier('iff2'), n.Literal(true))),
        n.ExpressionStatement(n.AssignmentExpression('=', n.Identifier('EI_inst'), n.Literal(true)))
      ];
    };
  },
  // @todo Apply peephole optimizations when port address is known.
  OUT: function(register1, register2) {
    if (register2 == undefined)
      return function(value, target, nextAddress) {
        // port.out(value, a);
        return n.ExpressionStatement(
            n.CallExpression('port.out', [n.Literal(value), n.Register(register1)])
        );
      };
    else
      return function() {
        // port.out(c, b);
        return n.ExpressionStatement(
            n.CallExpression('port.out', [n.Register(register1), n.Register(register2)])
        );
      };
  },
  IN: function(register1, register2) {
    if (register2 == undefined)
      return function(value, target, nextAddress) {
        // a = port.in_(value);
        return n.ExpressionStatement(
            n.AssignmentExpression('=', n.Register(register1), n.CallExpression('port.in_', n.Literal(value)))
        );
      };
    else
      return function(value, target, nextAddress) {
        // a = port.in_(c);
        // f = (f & F_CARRY) | SZP_TABLE[a];
        return [n.ExpressionStatement(
            n.AssignmentExpression('=', n.Register(register1), n.CallExpression('port.in_', n.Register(register2)))
          ),
          n.ExpressionStatement(n.AssignmentExpression('=', n.Register('f'),
              n.BinaryExpression('|',
              n.BinaryExpression('&', n.Register('f'), n.Literal(F_CARRY)),
              n.MemberExpression(n.Identifier('SZP_TABLE'), n.Register(register1))
              )
              ))
        ];
      };
  },
  EX_AF: function() {
    return function() {
      return o.EX('a', 'f');
    };
  },
  EXX: function() {
    return function() {
      // exBC();
      // exDE();
      // exHL();
      return [].concat(
          o.EX('b', 'c'),
          o.EX('d', 'e'),
          o.EX('h', 'l')
      );
    };
  },
  EX_SP_HL: function() {
    return function() {
      // temp = h;
      // h = readMem(sp + 1);
      // writeMem(sp + 1, temp);
      // temp = l;
      // l = readMem(sp);
      // writeMem(sp, temp);
      return [
        n.ExpressionStatement(n.AssignmentExpression('=', n.Identifier('temp'), n.Register('h'))),
        n.ExpressionStatement(n.AssignmentExpression('=', n.Register('h'), o.READ_MEM8(n.BinaryExpression('+', n.Identifier('sp'), n.Literal(1))))),
        n.ExpressionStatement(n.CallExpression('writeMem',
            [n.BinaryExpression('+', n.Identifier('sp'), n.Literal(1)),
             n.Identifier('temp')]
            )),
        n.ExpressionStatement(n.AssignmentExpression('=', n.Identifier('temp'), n.Register('l'))),
        n.ExpressionStatement(n.AssignmentExpression('=', n.Register('l'), o.READ_MEM8(n.Identifier('sp')))),
        n.ExpressionStatement(n.CallExpression('writeMem',
            [n.Identifier('sp'),
             n.Identifier('temp')]
            ))
      ];
    };
  },
  EX_DE_HL: function() {
    return function() {
      // temp = d;
      // d = h;
      // h = temp;
      // temp = e;
      // e = l;
      // l = temp;
      return [
        n.ExpressionStatement(n.AssignmentExpression('=', n.Identifier('temp'), n.Register('d'))),
        n.ExpressionStatement(n.AssignmentExpression('=', n.Register('d'), n.Register('h'))),
        n.ExpressionStatement(n.AssignmentExpression('=', n.Register('h'), n.Identifier('temp'))),
        n.ExpressionStatement(n.AssignmentExpression('=', n.Identifier('temp'), n.Register('e'))),
        n.ExpressionStatement(n.AssignmentExpression('=', n.Register('e'), n.Register('l'))),
        n.ExpressionStatement(n.AssignmentExpression('=', n.Register('l'), n.Identifier('temp')))
      ];
    };
  },
  HALT: function() {
    return function(value, target, nextAddress) {
      // if (HALT_SPEEDUP) {
      //   tstates = 0;
      // }
      // halt = true;
      // pc = (nextAddress - 1) + (page * 0x4000);
      // return;
      var ret = [];
      if (HALT_SPEEDUP)
        ret.push(n.ExpressionStatement(n.AssignmentExpression('=', n.Identifier('tstates'), n.Literal(0))));

      return ret.concat([
        n.ExpressionStatement(n.AssignmentExpression('=', n.Identifier('halt'), n.Literal(true))),
        n.ExpressionStatement(n.AssignmentExpression('=', n.Identifier('pc'), n.BinaryExpression('+',
            n.Literal((nextAddress - 1) % 0x4000), n.BinaryExpression('*',
            n.Identifier('page'), n.Literal(0x4000)
            )))),
        n.ReturnStatement()
      ]);
    };
  },
  // CB prefixed opcodes.
  RLC: generateCBFunctions('rlc'),
  RRC: generateCBFunctions('rrc'),
  RL: generateCBFunctions('rl'),
  RR: generateCBFunctions('rr'),
  SLA: generateCBFunctions('sla'),
  SRA: generateCBFunctions('sra'),
  SLL: generateCBFunctions('sll'),
  SRL: generateCBFunctions('srl'),
  BIT: function(bit, register1, register2) {
    if (register2 == undefined)
      return function() {
        // bit(b & BIT_0);
        return n.ExpressionStatement(
            n.CallExpression('bit', n.BinaryExpression('&', n.Register(register1), n.Bit(bit)))
        );
      };
    else if (register1 == 'h' && register2 == 'l')
      return function() {
        // bit(readMem(getHL()) & BIT_0);
        return n.ExpressionStatement(
            n.CallExpression('bit', n.BinaryExpression('&', o.READ_MEM8(n.CallExpression('get' + (register1 + register2).toUpperCase())), n.Bit(bit)))
        );
      };
    else
      return function(value, target, nextAddress) {
        // location = (getIYHIYL() + value) & 0xFFFF;
        // bit(readMem(location) & BIT_0);
        return [
          n.ExpressionStatement(n.AssignmentExpression('=', n.Identifier('location'),
              n.BinaryExpression('&', n.BinaryExpression('+',
              n.CallExpression('get' + (register1 + register2).toUpperCase()),
              n.Literal(value)),
              n.Literal(0xFFFF)))),
          n.ExpressionStatement(
              n.CallExpression('bit', n.BinaryExpression('&', o.READ_MEM8(n.Identifier('location')), n.Bit(bit)))
          )
        ];
      };
  },
  RES: function(bit, register1, register2) {
    if (register2 == undefined)
      return function() {
        // b &= ~BIT_0;
        return n.ExpressionStatement(
            n.AssignmentExpression('&=', n.Register(register1), n.UnaryExpression('~', n.Bit(bit)))
        );
      };
    else if (register1 == 'h' && register2 == 'l')
      return function() {
        // writeMem(getHL(), readMem(getHL()) & ~BIT_0);
        return n.ExpressionStatement(
            n.CallExpression('writeMem', n.CallExpression('get' + (register1 + register2).toUpperCase()),
            n.BinaryExpression('&',
            o.READ_MEM8(n.CallExpression('get' + (register1 + register2).toUpperCase())),
            n.UnaryExpression('~', n.Bit(bit)))
            )
        );
      };
    else
      return function(value, target, nextAddress) {
        // location = (getIYHIYL() + value) & 0xFFFF;
        // writeMem(location, readMem(location) & ~BIT_0);
        return [
          n.ExpressionStatement(n.AssignmentExpression('=', n.Identifier('location'),
              n.BinaryExpression('&', n.BinaryExpression('+',
              n.CallExpression('get' + (register1 + register2).toUpperCase()),
              n.Literal(value)),
              n.Literal(0xFFFF)))),
          n.ExpressionStatement(
              n.CallExpression('writeMem', [n.Identifier('location'),
                n.BinaryExpression('&',
                  o.READ_MEM8(n.Identifier('location')),
                  n.UnaryExpression('~', n.Bit(bit)))]
              )
          )
        ];
      };
  },
  SET: function(bit, register1, register2) {
    if (register2 == undefined)
      return function() {
        // b |= BIT_0;
        return n.ExpressionStatement(
            n.AssignmentExpression('|=', n.Register(register1), n.Bit(bit))
        );
      };
    else if (register1 == 'h' && register2 == 'l')
      return function() {
        // writeMem(getHL(), readMem(getHL()) | BIT_0);
        return n.ExpressionStatement(
            n.CallExpression('writeMem', [
              n.CallExpression('get' + (register1 + register2).toUpperCase()),
              n.BinaryExpression('|', o.READ_MEM8(n.CallExpression('get' + (register1 + register2).toUpperCase())), n.Bit(bit))
            ])
        );
      };
    else
      return function(value, target, nextAddress) {
        // location = (getIYHIYL() + value) & 0xFFFF;
        // writeMem(location, readMem(location) | BIT_0);
        return [
          n.ExpressionStatement(n.AssignmentExpression('=', n.Identifier('location'),
              n.BinaryExpression('&', n.BinaryExpression('+',
              n.CallExpression('get' + (register1 + register2).toUpperCase()),
              n.Literal(value)),
              n.Literal(0xFFFF)))),
          n.ExpressionStatement(
              n.CallExpression('writeMem', [n.Identifier('location'),
                n.BinaryExpression('|',
                  o.READ_MEM8(n.Identifier('location')),
                  n.Bit(bit))]
              )
          )
        ];
      };
  },
  // DD/FD prefixed opcodes.
  LD_X: function(register1, register2, register3) {
    if (register3 == undefined)
      return function(value, target, nextAddress) {
        // writeMem(getIXHIXL() + (value >> 8), value & 0xFF);
        return [
          n.ExpressionStatement(n.CallExpression('writeMem', [
            n.BinaryExpression('+',
                n.CallExpression('get' + (register1 + register2).toUpperCase()),
                n.Literal(value & 0xFF)),
            n.Literal(value >> 8)
          ]))
        ];
      };
    else
      return function(value, target, nextAddress) {
        // writeMem(getIXHIXL() + value, b);
        return [
          n.ExpressionStatement(n.CallExpression('writeMem', [
            n.BinaryExpression('+',
                n.CallExpression('get' + (register2 + register3).toUpperCase()),
                n.Literal(value)),
            n.Register(register1)
          ]))
        ];
      };
  },
  INC_X: function(register1, register2) {
    return function(value, target, nextAddress) {
      // incMem(getIXHIXL() + value);
      return [
        n.ExpressionStatement(n.CallExpression('incMem',
            n.BinaryExpression('+', n.CallExpression('get' + (register1 + register2).toUpperCase()),
            n.Literal(value))
            ))
      ];
    };
  },
  DEC_X: function(register1, register2) {
    return function(value, target, nextAddress) {
      // decMem(getIXHIXL() + value);
      return [
        n.ExpressionStatement(n.CallExpression('decMem',
            n.BinaryExpression('+', n.CallExpression('get' + (register1 + register2).toUpperCase()),
            n.Literal(value)))
        )
      ];
    };
  },
  ADD_X: function(register1, register2) {
    return function(value, target, nextAddress) {
      // add_a(readMem(getIXHIXL() + value));
      return n.ExpressionStatement(
          n.CallExpression('add_a', o.READ_MEM8(n.BinaryExpression('+', n.CallExpression('get' + (register1 + register2).toUpperCase()),
          n.Literal(value))))
      );
    };
  },
  ADC_X: function(register1, register2) {
    return function(value, target, nextAddress) {
      // adc_a(readMem(getIXHIXL() + value));
      return n.ExpressionStatement(
          n.CallExpression('adc_a', o.READ_MEM8(n.BinaryExpression('+', n.CallExpression('get' + (register1 + register2).toUpperCase()),
          n.Literal(value))))
      );
    };
  },
  SUB_X: function(register1, register2) {
    return function(value, target, nextAddress) {
      // sub_a(readMem(getIXHIXL() + value));
      return n.ExpressionStatement(
          n.CallExpression('sub_a', o.READ_MEM8(n.BinaryExpression('+', n.CallExpression('get' + (register1 + register2).toUpperCase()),
          n.Literal(value))))
      );
    };
  },
  SBC_X: function(register1, register2) {
    return function(value, target, nextAddress) {
      // sbc_a(readMem(getIXHIXL() + value));
      return n.ExpressionStatement(
          n.CallExpression('sbc_a', o.READ_MEM8(n.BinaryExpression('+', n.CallExpression('get' + (register1 + register2).toUpperCase()),
          n.Literal(value))))
      );
    };
  },
  OR_X: function(register1, register2) {
    return function(value, target, nextAddress) {
      // a |= readMem(getIXHIXL() + value);
      // f = SZP_TABLE[a];
      return [
        n.ExpressionStatement(
            n.AssignmentExpression('|=', n.Register('a'), o.READ_MEM8(n.BinaryExpression('+', n.CallExpression('get' + (register1 + register2).toUpperCase()),
            n.Literal(value))))),
        n.ExpressionStatement(
            n.AssignmentExpression('=', n.Register('f'),
            n.MemberExpression(n.Identifier('SZP_TABLE'), n.Register('a'))
            )
        )
      ];
    };
  },
  XOR_X: function(register1, register2) {
    return function(value, target, nextAddress) {
      // a ^= readMem(getIXHIXL() + value);
      // f = SZP_TABLE[a];
      return [
        n.ExpressionStatement(
            n.AssignmentExpression('^=', n.Register('a'), o.READ_MEM8(n.BinaryExpression('+', n.CallExpression('get' + (register1 + register2).toUpperCase()),
            n.Literal(value))))),
        n.ExpressionStatement(
            n.AssignmentExpression('=', n.Register('f'),
            n.MemberExpression(n.Identifier('SZP_TABLE'), n.Register('a'))
            )
        )
      ];
    };
  },
  CP_X: function(register1, register2) {
    return function(value) {
      // cp_a(readMem(getIXHIXL() + value));
      return n.ExpressionStatement(
          n.CallExpression('cp_a', o.READ_MEM8(n.BinaryExpression('+', n.CallExpression('get' + (register1 + register2).toUpperCase()),
          n.Literal(value))))
      );
    };
  },
  EX_SP_X: function(register1, register2) {
    return function() {
      // temp = getIYHIYL();
      // setIYHIYL(readMemWord(sp));
      // writeMem(sp, temp & 0xFF);
      // writeMem(sp + 1, temp >> 8);
      return [].concat(
          n.ExpressionStatement(n.AssignmentExpression('=', n.Identifier('temp'), n.CallExpression('get' + (register1 + register2).toUpperCase()))),
          o.SET16(register1, register2, o.READ_MEM16(n.Identifier('sp'))),
          n.ExpressionStatement(n.CallExpression('writeMem', [n.Identifier('sp'),
            n.BinaryExpression('&', n.Identifier('temp'), n.Literal(0xFF))]
          )),
          n.ExpressionStatement(n.CallExpression('writeMem', [n.BinaryExpression('+', n.Identifier('sp'), n.Literal(1)),
            n.BinaryExpression('>>', n.Identifier('sp'), n.Literal(8))]
          ))
      );
    };
  },
  JP_X: function(register1, register2) {
    return function(value, target, nextAddress) {
      // pc = getIXHIXL();
      return [
        n.ExpressionStatement(n.AssignmentExpression('=', n.Identifier('pc'), n.CallExpression('get' + (register1 + register2).toUpperCase()))),
        n.ReturnStatement()
      ];
    };
  },
  // ED prefixed opcodes.
  ADC16: function(register1, register2) {
    return function(value, target, nextAddress) {
      if (register2 == undefined)
        // var value = sp;
        var valueAST = n.VariableDeclaration('value', n.Identifier(register1));
      else
        // var val = (b << 8) | c;
        var valueAST = n.VariableDeclaration('value', n.BinaryExpression('|', n.BinaryExpression('<<', n.Register(register1), n.Literal(8)), n.Register(register2)));

      // var value = getBC();
      // var val = (h << 8) | l;
      // temp = val + value + (f & F_CARRY);
      // f = (((val ^ temp ^ value) >> 8) & 0x10) | ((temp >> 16) & 1) | ((temp >> 8) & 0x80) | (((temp & 0xFFFF) != 0) ? 0 : 0x40) | (((value ^ val ^ 0x8000) & (value ^ temp) & 0x8000) >> 13);
      // h = (temp >> 8) & 0xFF;
      // l = temp & 0xFF;
      return [
        valueAST,
        n.VariableDeclaration('val', n.BinaryExpression('|', n.BinaryExpression('<<', n.Register('h'), n.Literal(8)), n.Register('l'))),
        n.ExpressionStatement(n.AssignmentExpression('=', n.Identifier('temp'),
            n.BinaryExpression('+',
            n.BinaryExpression('+', n.Identifier('val'), n.Identifier('value')),
            n.BinaryExpression('&', n.Register('f'), n.Literal(F_CARRY)))
            )
        ),
        n.ExpressionStatement(
            n.AssignmentExpression('=', n.Register('f'),
            n.BinaryExpression('|',
              n.BinaryExpression('|',
                n.BinaryExpression('|',
                  n.BinaryExpression('|',
                    n.BinaryExpression('&',
                      n.BinaryExpression('>>',
                        n.BinaryExpression('^',
                          n.BinaryExpression('^', n.Identifier('val'), n.Identifier('temp')),
                          n.Identifier('value')
                        ),
                        n.Literal(0x08)
                      ),
                      n.Literal(0x10)
                    ),
                    n.BinaryExpression('&',
                      n.BinaryExpression('>>', n.Identifier('temp'), n.Literal(0x10)),
                      n.Literal(0x01)
                    )
                  ),
                  n.BinaryExpression('&',
                    n.BinaryExpression('>>', n.Identifier('temp'), n.Literal(0x08)),
                    n.Literal(0x80)
                  )
                ),
                n.ConditionalExpression(
                  n.BinaryExpression('!=',
                    n.BinaryExpression('&', n.Identifier('temp'), n.Literal(0xFFFF)),
                    n.Literal(0x00)
                  ),
                  n.Literal(0x00),
                  n.Literal(0x40)
                )
              ),
              n.BinaryExpression('>>',
                n.BinaryExpression('&',
                  n.BinaryExpression('&',
                    n.BinaryExpression('^',
                      n.BinaryExpression('^', n.Identifier('value'), n.Identifier('val')),
                      n.Literal(0x8000)
                    ),
                    n.BinaryExpression('^', n.Identifier('value'), n.Identifier('temp'))
                  ),
                  n.Literal(0x8000)
                ),
                n.Literal(0x0D)
              )
            )
            )
        ),
        n.ExpressionStatement(
            n.AssignmentExpression('=', n.Register('h'),
            n.BinaryExpression('&',
              n.BinaryExpression('>>', n.Identifier('temp'), n.Literal(0x08)),
              n.Literal(0xFF)
            )
            )
        ),
        n.ExpressionStatement(
            n.AssignmentExpression('=', n.Register('l'),
            n.BinaryExpression('&', n.Identifier('temp'), n.Literal(0xFF))
            )
        )
      ];
    };
  },
  SBC16: function(register1, register2) {
    return function(value, target, nextAddress) {
      if (register2 == undefined)
        // var value = sp;
        var valueAST = n.VariableDeclaration('value', n.Identifier(register1));
      else
        // var val = (b << 8) | c;
        var valueAST = n.VariableDeclaration('value', n.BinaryExpression('|', n.BinaryExpression('<<', n.Register(register1), n.Literal(8)), n.Register(register2)));

      // var value = getBC();
      // var val = (h << 8) | l;
      // temp = val - value - (f & F_CARRY);
      // f = (((val ^ temp ^ value) >> 8) & 0x10) | ((temp >> 16) & 1) | ((temp >> 8) & 0x80) | (((temp & 0xFFFF) != 0) ? 0 : 0x40) | (((value ^ val ^ 0x8000) & (value ^ temp) & 0x8000) >> 13);
      // h = (temp >> 8) & 0xFF;
      // l = temp & 0xFF;
      return [
        valueAST,
        n.VariableDeclaration('val', n.BinaryExpression('|', n.BinaryExpression('<<', n.Register('h'), n.Literal(8)), n.Register('l'))),
        n.ExpressionStatement(n.AssignmentExpression('=', n.Identifier('temp'),
            n.BinaryExpression('-',
            n.BinaryExpression('-', n.Identifier('val'), n.Identifier('value')),
            n.BinaryExpression('&', n.Register('f'), n.Literal(F_CARRY)))
            )
        ),
        n.ExpressionStatement(
            n.AssignmentExpression('=', n.Register('f'),
            n.BinaryExpression('|',
              n.BinaryExpression('|',
                n.BinaryExpression('|',
                  n.BinaryExpression('|',
                    n.BinaryExpression('|',
                      n.BinaryExpression('&',
                        n.BinaryExpression('>>',
                          n.BinaryExpression('^',
                            n.BinaryExpression('^', n.Identifier('val'), n.Identifier('temp')),
                            n.Identifier('value')
                          ),
                          n.Literal(0x08)
                        ),
                        n.Literal(0x10)
                      ),
                      n.Literal(0x02)
                    ),
                    n.BinaryExpression('&',
                      n.BinaryExpression('>>', n.Identifier('temp'), n.Literal(0x10)),
                      n.Literal(0x01)
                    )
                  ),
                  n.BinaryExpression('&',
                    n.BinaryExpression('>>', n.Identifier('temp'), n.Literal(0x08)),
                    n.Literal(0x80)
                  )
                ),
                n.ConditionalExpression(
                  n.BinaryExpression('!=',
                    n.BinaryExpression('&', n.Identifier('temp'), n.Literal(0xFFFF)),
                    n.Literal(0x00)
                  ),
                  n.Literal(0x00),
                  n.Literal(0x40)
                )
              ),
              n.BinaryExpression('>>',
                n.BinaryExpression('&',
                  n.BinaryExpression('&',
                    n.BinaryExpression('^', n.Identifier('value'), n.Identifier('val')),
                    n.BinaryExpression('^', n.Identifier('val'), n.Identifier('temp'))
                  ),
                  n.Literal(0x8000)
                ),
                n.Literal(0x0D)
              )
            )
            )
        ),
        n.ExpressionStatement(
            n.AssignmentExpression('=', n.Register('h'),
            n.BinaryExpression('&',
              n.BinaryExpression('>>', n.Identifier('temp'), n.Literal(0x08)),
              n.Literal(0xFF)
            )
            )
        ),
        n.ExpressionStatement(
            n.AssignmentExpression('=', n.Register('l'),
            n.BinaryExpression('&', n.Identifier('temp'), n.Literal(0xFF))
            )
        )
      ];
    };
  },
  NEG: function() {
    return function() {
      // temp = a;
      // a = 0;
      // sub_a(temp);
      return [
        n.ExpressionStatement(n.AssignmentExpression('=', n.Identifier('temp'), n.Register('a'))),
        n.ExpressionStatement(n.AssignmentExpression('=', n.Register('a'), n.Literal(0))),
        n.ExpressionStatement(n.CallExpression('sub_a', n.Identifier('temp')))
      ];
    };
  },
  RETN_RETI: function() {
    return function() {
      // pc = readMemWord(sp);
      // sp += 2;
      // iff1 = iff2;
      return [
        n.ExpressionStatement(n.AssignmentExpression('=', n.Identifier('pc'), o.READ_MEM16(n.Identifier('sp')))),
        n.ExpressionStatement(n.AssignmentExpression('+=', n.Identifier('sp'), n.Literal(2))),
        n.ExpressionStatement(n.AssignmentExpression('=', n.Identifier('iff1'), n.Identifier('iff2')))
      ];
    };
  },
  IM: function(value) {
    return function() {
      // im = value;
      return n.ExpressionStatement(
          n.AssignmentExpression('=', n.Identifier('im'), n.Literal(value))
      );
    };
  },
  INI: function() {
    return function(value, target, nextAddress) {
      // temp = port.in_(c);
      // writeMem(getHL(), temp);
      // b = dec8(b);
      // incHL();
      // if ((temp & 0x80) == 0x80) {
      //   f |= F_NEGATIVE;
      // } else {
      //   f &= ~ F_NEGATIVE;
      // }
      // undocumented flags not finished.

      return [
        n.ExpressionStatement(n.AssignmentExpression('=', n.Identifier('temp'), n.CallExpression('port.in_', n.Register('c')))),
        n.ExpressionStatement(n.CallExpression('writeMem', [n.CallExpression('get' + ('h' + 'l').toUpperCase()), n.Identifier('temp')])),
        o.DEC8('b')(),
        n.ExpressionStatement(n.CallExpression('incHL')),
        n.IfStatement(
            n.BinaryExpression('==', n.BinaryExpression('&', n.Identifier('temp'), n.Literal(0x80)), n.Literal(0x80)),
            n.BlockStatement(
            n.ExpressionStatement(n.AssignmentExpression('|=', n.Register('f'), n.Literal(F_NEGATIVE)))
            ),
            n.BlockStatement(
            n.ExpressionStatement(n.AssignmentExpression('&=', n.Register('f'), n.UnaryExpression('~', n.Literal(F_NEGATIVE))))
            )
        )
      ];
    }
  },
  OUTI: function() {
    return function(value, target, nextAddress) {
      // temp = readMem(getHL());
      // port.out(c, temp);
      // b = dec8(b);
      // incHL();
      // if ((l + temp) > 255) {
      //   f |= F_CARRY;
      //   f |= F_HALFCARRY;
      // } else {
      //   f &= ~ F_CARRY;
      //   f &= ~ F_HALFCARRY;
      // }
      // if ((temp & 0x80) == 0x80) {
      //   f |= F_NEGATIVE;
      // } else {
      //   f &= ~ F_NEGATIVE;
      // }

      return [
        n.ExpressionStatement(n.AssignmentExpression('=', n.Identifier('temp'), o.READ_MEM8(n.CallExpression('get' + ('h' + 'l').toUpperCase())))),
        n.ExpressionStatement(n.CallExpression('port.out', [n.Register('c'), n.Identifier('temp')])),
        o.DEC8('b')(),
        n.ExpressionStatement(n.CallExpression('incHL')),
        n.IfStatement(
            n.BinaryExpression('>', n.BinaryExpression('+', n.Register('l'), n.Identifier('temp')), n.Literal(255)),
            n.BlockStatement([
              n.ExpressionStatement(n.AssignmentExpression('|=', n.Register('f'), n.Literal(F_CARRY))),
              n.ExpressionStatement(n.AssignmentExpression('|=', n.Register('f'), n.Literal(F_HALFCARRY)))
            ]),
            n.BlockStatement([
              n.ExpressionStatement(n.AssignmentExpression('&=', n.Register('f'), n.UnaryExpression('~', n.Literal(F_CARRY)))),
              n.ExpressionStatement(n.AssignmentExpression('&=', n.Register('f'), n.UnaryExpression('~', n.Literal(F_HALFCARRY))))
            ])
        ),
        n.IfStatement(
            n.BinaryExpression('==', n.BinaryExpression('&', n.Identifier('temp'), n.Literal(0x80)), n.Literal(0x80)),
            n.BlockStatement(
            n.ExpressionStatement(n.AssignmentExpression('|=', n.Register('f'), n.Literal(F_NEGATIVE)))
            ),
            n.BlockStatement(
            n.ExpressionStatement(n.AssignmentExpression('&=', n.Register('f'), n.UnaryExpression('~', n.Literal(F_NEGATIVE))))
            )
        )
      ];
    }
  },
  OUTD: function() {
    return function(value, target, nextAddress) {
      // temp = readMem(getHL());
      // port.out(c, temp);
      // b = dec8(b);
      // decHL();
      // if ((l + temp) > 255) {
      //   f |= F_CARRY;
      //   f |= F_HALFCARRY;
      // } else {
      //   f &= ~ F_CARRY;
      //   f &= ~ F_HALFCARRY;
      // }
      // if ((temp & 0x80) == 0x80) {
      //   f |= F_NEGATIVE;
      // } else {
      //   f &= ~ F_NEGATIVE;
      // }

      return [
        n.ExpressionStatement(n.AssignmentExpression('=', n.Identifier('temp'), o.READ_MEM8(n.CallExpression('get' + ('h' + 'l').toUpperCase())))),
        n.ExpressionStatement(n.CallExpression('port.out', [n.Register('c'), n.Identifier('temp')])),
        o.DEC8('b')(),
        n.ExpressionStatement(n.CallExpression('decHL')),
        n.IfStatement(
            n.BinaryExpression('>', n.BinaryExpression('+', n.Register('l'), n.Identifier('temp')), n.Literal(255)),
            n.BlockStatement([
              n.ExpressionStatement(n.AssignmentExpression('|=', n.Register('f'), n.Literal(F_CARRY))),
              n.ExpressionStatement(n.AssignmentExpression('|=', n.Register('f'), n.Literal(F_HALFCARRY)))
            ]),
            n.BlockStatement([
              n.ExpressionStatement(n.AssignmentExpression('&=', n.Register('f'), n.UnaryExpression('~', n.Literal(F_CARRY)))),
              n.ExpressionStatement(n.AssignmentExpression('&=', n.Register('f'), n.UnaryExpression('~', n.Literal(F_HALFCARRY))))
            ])
        ),
        n.IfStatement(
            n.BinaryExpression('==', n.BinaryExpression('&', n.Identifier('temp'), n.Literal(0x80)), n.Literal(0x80)),
            n.BlockStatement(
            n.ExpressionStatement(n.AssignmentExpression('|=', n.Register('f'), n.Literal(F_NEGATIVE)))
            ),
            n.BlockStatement(
            n.ExpressionStatement(n.AssignmentExpression('&=', n.Register('f'), n.UnaryExpression('~', n.Literal(F_NEGATIVE))))
            )
        )
      ];
    }
  },
  LDI: function() {
    return function(value, target, nextAddress) {
      // temp = readMem(getHL());
      // writeMem(getDE(), temp);
      // decBC();
      // incDE();
      // incHL();
      // temp = (temp + a) & 0xFF;
      // f = (f & 0xC1) | (getBC() ? F_PARITY : 0) | (temp & 0x08) | ((temp & 0x02) ? 0x20 : 0);
      return [
        n.ExpressionStatement(n.AssignmentExpression('=', n.Identifier('temp'), o.READ_MEM8(n.CallExpression('get' + ('h' + 'l').toUpperCase())))),
        n.ExpressionStatement(
            n.CallExpression('writeMem', [
              n.CallExpression('get' + ('d' + 'e').toUpperCase()),
              n.Identifier('temp')])
        ),
        n.ExpressionStatement(n.CallExpression('decBC')),
        n.ExpressionStatement(n.CallExpression('incDE')),
        n.ExpressionStatement(n.CallExpression('incHL')),
        n.ExpressionStatement(n.AssignmentExpression('=', n.Identifier('temp'), n.BinaryExpression('&',
            n.BinaryExpression('+', n.Identifier('temp'), n.Register('a')), n.Literal(0xFF)))),
        n.ExpressionStatement(n.AssignmentExpression('=', n.Register('f'),
            n.BinaryExpression('|',
            n.BinaryExpression('|',
              n.BinaryExpression('|',
                n.BinaryExpression('&', n.Register('f'), n.Literal(0xC1)),
                n.ConditionalExpression(n.CallExpression('get' + ('b' + 'c').toUpperCase()), n.Literal(F_PARITY), n.Literal(0x00))),
              n.BinaryExpression('&', n.Identifier('temp'), n.Literal(F_BIT3))),
            n.ConditionalExpression(
              n.BinaryExpression('&', n.Identifier('temp'), n.Literal(F_NEGATIVE)),
              n.Literal(0x20),
              n.Literal(0))
            )))
      ];
    };
  },
  CPI: function() {
    return function(value, target, nextAddress) {
      // temp = (f & F_CARRY) | F_NEGATIVE;
      // cp_a(readMem(getHL())); // sets some flags
      // decBC();
      // incHL();
      // temp |= (getBC() == 0 ? 0 : F_PARITY);
      // f = (f & 0xF8) | temp;
      return [
        n.ExpressionStatement(n.AssignmentExpression('=', n.Identifier('temp'),
            n.BinaryExpression('|',
            n.BinaryExpression('&', n.Register('f'), n.Literal(F_CARRY)),
            n.Literal(F_NEGATIVE)
            )
            )),
        n.ExpressionStatement(
            n.CallExpression('cp_a', [
              o.READ_MEM8(n.CallExpression('get' + ('h' + 'l').toUpperCase()))
            ])
        ),
        n.ExpressionStatement(n.CallExpression('decBC')),
        n.ExpressionStatement(n.CallExpression('incHL')),
        n.ExpressionStatement(n.AssignmentExpression('|=', n.Identifier('temp'), n.ConditionalExpression(
            n.BinaryExpression('==', n.CallExpression('get' + ('b' + 'c').toUpperCase()), n.Literal(0)),
            n.Literal(0),
            n.Literal(F_PARITY)
            ))),
        n.ExpressionStatement(n.AssignmentExpression('=', n.Register('f'), n.BinaryExpression('|',
            n.BinaryExpression('&', n.Register('f'), n.Literal(0xF8)),
            n.Identifier('temp')
            )))
      ];
    };
  },
  LDD: function() {
    return function(value, target, nextAddress) {
      // temp = readMem(getHL());
      // writeMem(getDE(), temp);
      // decBC();
      // decDE();
      // decHL();
      // temp = (temp + a) & 0xFF;
      // f = (f & 0xC1) | (getBC() ? F_PARITY : 0) | (temp & F_BIT3) | ((temp & F_NEGATIVE) ? 0x20 : 0);
      return [
        n.ExpressionStatement(n.AssignmentExpression('=', n.Identifier('temp'), o.READ_MEM8(n.CallExpression('get' + ('h' + 'l').toUpperCase())))),
        n.ExpressionStatement(
            n.CallExpression('writeMem', [
              n.CallExpression('get' + ('d' + 'e').toUpperCase()),
              n.Identifier('temp')])
        ),
        n.ExpressionStatement(n.CallExpression('decBC')),
        n.ExpressionStatement(n.CallExpression('decDE')),
        n.ExpressionStatement(n.CallExpression('decHL')),
        n.ExpressionStatement(n.AssignmentExpression('=', n.Identifier('temp'), n.BinaryExpression('&',
            n.BinaryExpression('+', n.Identifier('temp'), n.Register('a')), n.Literal(0xFF)))),
        n.ExpressionStatement(n.AssignmentExpression('=', n.Register('f'),
            n.BinaryExpression('|',
            n.BinaryExpression('|',
              n.BinaryExpression('|',
                n.BinaryExpression('&', n.Register('f'), n.Literal(0xC1)),
                n.ConditionalExpression(n.CallExpression('get' + ('b' + 'c').toUpperCase()), n.Literal(F_PARITY), n.Literal(0x00))),
              n.BinaryExpression('&', n.Identifier('temp'), n.Literal(F_BIT3))),
            n.ConditionalExpression(
              n.BinaryExpression('&', n.Identifier('temp'), n.Literal(F_NEGATIVE)),
              n.Literal(0x20),
              n.Literal(0))
            )))
      ];
    };
  },
  LDIR: function() {
    return function(value, target, nextAddress) {
      // temp = readMem(getHL());
      // writeMem(getDE(), temp);
      // decBC();
      // incDE();
      // incHL();
      // temp = (temp + a) & 0xFF;
      // f = (f & 0xC1) | (getBC() ? F_PARITY : 0) | (temp & 0x08) | ((temp & 0x02) ? 0x20 : 0);
      // if (getBC() != 0) {
      //   tstates -= 5;
      //   return;
      // }
      return [
        n.ExpressionStatement(n.AssignmentExpression('=', n.Identifier('temp'), o.READ_MEM8(n.CallExpression('get' + ('h' + 'l').toUpperCase())))),
        n.ExpressionStatement(
            n.CallExpression('writeMem', [
              n.CallExpression('get' + ('d' + 'e').toUpperCase()),
              n.Identifier('temp')])
        ),
        n.ExpressionStatement(n.CallExpression('decBC')),
        n.ExpressionStatement(n.CallExpression('incDE')),
        n.ExpressionStatement(n.CallExpression('incHL')),
        n.ExpressionStatement(n.AssignmentExpression('=', n.Identifier('temp'), n.BinaryExpression('&',
            n.BinaryExpression('+', n.Identifier('temp'), n.Register('a')), n.Literal(0xFF)))),
        n.ExpressionStatement(n.AssignmentExpression('=', n.Register('f'),
            n.BinaryExpression('|',
            n.BinaryExpression('|',
              n.BinaryExpression('|',
                n.BinaryExpression('&', n.Register('f'), n.Literal(0xC1)),
                n.ConditionalExpression(n.CallExpression('get' + ('b' + 'c').toUpperCase()), n.Literal(F_PARITY), n.Literal(0x00))),
              n.BinaryExpression('&', n.Identifier('temp'), n.Literal(F_BIT3))),
            n.ConditionalExpression(
              n.BinaryExpression('&', n.Identifier('temp'), n.Literal(F_NEGATIVE)),
              n.Literal(0x20),
              n.Literal(0))
            ))),
        n.IfStatement(
            n.BinaryExpression('!=', n.CallExpression('get' + ('b' + 'c').toUpperCase()), n.Literal(0)),
            n.BlockStatement([
              n.ExpressionStatement(n.AssignmentExpression('-=', n.Identifier('tstates'), n.Literal(5))),
              n.ReturnStatement()
            ])
        )
      ];
    };
  },
  CPIR: function() {
    return function(value, target, nextAddress) {
      // temp = (f & F_CARRY) | F_NEGATIVE;
      // cp_a(readMem(getHL())); // sets zero flag for us
      // decBC();
      // incHL();
      // temp |= (getBC() == 0 ? 0 : F_PARITY);
      // Repeat instruction until a = (hl) or bc == 0
      // if ((temp & F_PARITY) != 0 && (f & F_ZERO) == 0) {
      //   tstates -= 5;
      //   f = (f & 0xF8) | temp;
      //   return;
      // }
      // f = (f & 0xF8) | temp;
      return [
        n.ExpressionStatement(n.AssignmentExpression('=', n.Identifier('temp'),
            n.BinaryExpression('|',
            n.BinaryExpression('&', n.Register('f'), n.Literal(F_CARRY)),
            n.Literal(F_NEGATIVE)
            )
            )),
        n.ExpressionStatement(
            n.CallExpression('cp_a', [
              o.READ_MEM8(n.CallExpression('get' + ('h' + 'l').toUpperCase()))
            ])
        ),
        n.ExpressionStatement(n.CallExpression('decBC')),
        n.ExpressionStatement(n.CallExpression('incHL')),
        n.ExpressionStatement(n.AssignmentExpression('|=', n.Identifier('temp'), n.ConditionalExpression(
            n.BinaryExpression('==', n.CallExpression('get' + ('b' + 'c').toUpperCase()), n.Literal(0)),
            n.Literal(0),
            n.Literal(F_PARITY)
            ))),
        n.IfStatement(
            n.LogicalExpression('&&',
            n.BinaryExpression('!=', n.BinaryExpression('&', n.Identifier('temp'), n.Literal(F_PARITY)), n.Literal(0)),
            n.BinaryExpression('==', n.BinaryExpression('&', n.Register('f'), n.Literal(F_ZERO)), n.Literal(0))
            ),
            n.BlockStatement([
              n.ExpressionStatement(n.AssignmentExpression('-=', n.Identifier('tstates'), n.Literal(5))),
              n.ExpressionStatement(n.AssignmentExpression('=', n.Register('f'), n.BinaryExpression('|',
                n.BinaryExpression('&', n.Register('f'), n.Literal(0xF8)),
                n.Identifier('temp')
                ))),
              n.ReturnStatement()
            ])
        ),
        n.ExpressionStatement(n.AssignmentExpression('=', n.Register('f'), n.BinaryExpression('|',
            n.BinaryExpression('&', n.Register('f'), n.Literal(0xF8)),
            n.Identifier('temp')
            )))
      ];
    };
  },
  OTIR: function() {
    return function(value, target, nextAddress) {
      // temp = readMem(getHL());
      // port.out(c, temp);
      // b = dec8(b);
      // incHL();
      // if ((l + temp) > 255) {
      //   f |= F_CARRY;
      //   f |= F_HALFCARRY;
      // } else {
      //   f &= ~ F_CARRY;
      //   f &= ~ F_HALFCARRY;
      // }
      // if ((temp & 0x80) != 0) {
      //   f |= F_NEGATIVE;
      // } else {
      //   f &= ~ F_NEGATIVE;
      // }
      // if (b != 0) {
      //   tstates -= 5;
      //   return;
      // }
      return [
        n.ExpressionStatement(n.AssignmentExpression('=', n.Identifier('temp'), o.READ_MEM8(n.CallExpression('get' + ('h' + 'l').toUpperCase())))),
        n.ExpressionStatement(n.CallExpression('port.out', [n.Register('c'), n.Identifier('temp')])),
        o.DEC8('b')(),
        n.ExpressionStatement(n.CallExpression('incHL')),
        n.IfStatement(
            n.BinaryExpression('>', n.BinaryExpression('+', n.Register('l'), n.Identifier('temp')), n.Literal(255)),
            n.BlockStatement([
              n.ExpressionStatement(n.AssignmentExpression('|=', n.Register('f'), n.Literal(F_CARRY))),
              n.ExpressionStatement(n.AssignmentExpression('|=', n.Register('f'), n.Literal(F_HALFCARRY)))
            ]),
            n.BlockStatement([
              n.ExpressionStatement(n.AssignmentExpression('&=', n.Register('f'), n.UnaryExpression('~', n.Literal(F_CARRY)))),
              n.ExpressionStatement(n.AssignmentExpression('&=', n.Register('f'), n.UnaryExpression('~', n.Literal(F_HALFCARRY))))
            ])
        ),
        n.IfStatement(
            n.BinaryExpression('!=', n.BinaryExpression('&', n.Identifier('temp'), n.Literal(0x80)), n.Literal(0)),
            n.BlockStatement(
            n.ExpressionStatement(n.AssignmentExpression('|=', n.Register('f'), n.Literal(F_NEGATIVE)))
            ),
            n.BlockStatement(
            n.ExpressionStatement(n.AssignmentExpression('&=', n.Register('f'), n.UnaryExpression('~', n.Literal(F_NEGATIVE))))
            )
        ),
        n.IfStatement(
            n.BinaryExpression('!=', n.Register('b'), n.Literal(0)),
            n.BlockStatement([
              n.ExpressionStatement(n.AssignmentExpression('-=', n.Identifier('tstates'), n.Literal(5))),
              n.ReturnStatement()
            ])
        )
      ];
    };
  },
  LDDR: function() {
    return function(value, target, nextAddress) {
      // temp = readMem(getHL());
      // writeMem(getDE(), temp);
      // decBC();
      // decDE();
      // decHL();
      // temp = (temp + a) & 0xFF;
      // f = (f & 0xC1) | (getBC() ? F_PARITY : 0) | (temp & F_BIT3) | ((temp & F_NEGATIVE) ? 0x20 : 0);
      // if (getBC() != 0) {
      //   tstates -= 5;
      //   return;
      // }
      return [
        n.ExpressionStatement(n.AssignmentExpression('=', n.Identifier('temp'), o.READ_MEM8(n.CallExpression('get' + ('h' + 'l').toUpperCase())))),
        n.ExpressionStatement(
            n.CallExpression('writeMem', [
              n.CallExpression('get' + ('d' + 'e').toUpperCase()),
              n.Identifier('temp')])
        ),
        n.ExpressionStatement(n.CallExpression('decBC')),
        n.ExpressionStatement(n.CallExpression('decDE')),
        n.ExpressionStatement(n.CallExpression('decHL')),
        n.ExpressionStatement(n.AssignmentExpression('=', n.Identifier('temp'), n.BinaryExpression('&',
            n.BinaryExpression('+', n.Identifier('temp'), n.Register('a')), n.Literal(0xFF)))),
        n.ExpressionStatement(n.AssignmentExpression('=', n.Register('f'),
            n.BinaryExpression('|',
            n.BinaryExpression('|',
              n.BinaryExpression('|',
                n.BinaryExpression('&', n.Register('f'), n.Literal(0xC1)),
                n.ConditionalExpression(n.CallExpression('get' + ('b' + 'c').toUpperCase()), n.Literal(F_PARITY), n.Literal(0x00))),
              n.BinaryExpression('&', n.Identifier('temp'), n.Literal(F_BIT3))),
            n.ConditionalExpression(
              n.BinaryExpression('&', n.Identifier('temp'), n.Literal(F_NEGATIVE)),
              n.Literal(0x20),
              n.Literal(0))
            ))),
        n.IfStatement(
            n.BinaryExpression('!=', n.CallExpression('get' + ('b' + 'c').toUpperCase()), n.Literal(0)),
            n.BlockStatement([
              n.ExpressionStatement(n.AssignmentExpression('-=', n.Identifier('tstates'), n.Literal(5))),
              n.ReturnStatement()
            ])
        )
      ];
    };
  },
  // DD/FD CB prefixed opcodes.
  LD_RLC: generateIndexCBFunctions('rlc'),
  LD_RRC: generateIndexCBFunctions('rrc'),
  LD_RL: generateIndexCBFunctions('rl'),
  LD_RR: generateIndexCBFunctions('rr'),
  LD_SLA: generateIndexCBFunctions('sla'),
  LD_SRA: generateIndexCBFunctions('sra'),
  LD_SLL: generateIndexCBFunctions('sll'),
  LD_SRL: generateIndexCBFunctions('srl'),
  // Below these point, properties can't be called from outside object `n`.
  // Move to object `o`? Mark as private?
  READ_MEM8: function(value) {
    return n.CallExpression('readMem', value);
  },
  READ_MEM16: function(value) {
    return n.CallExpression('readMemWord', value);
  }
};

function generateCBFunctions(fn) {
  return function(register1, register2) {
    if (register2 == undefined)
      return function() {
        // b = rlc(b);
        return n.ExpressionStatement(
            n.AssignmentExpression('=', n.Register(register1), n.CallExpression(fn, n.Register(register1)))
        );
      };
    else
      return function() {
        // writeMem(getHL(), rlc(readMem(getHL())));
        return n.ExpressionStatement(
            n.CallExpression('writeMem', n.CallExpression('get' + (register1 + register2).toUpperCase()),
            n.CallExpression(fn, o.READ_MEM8(n.CallExpression('get' + (register1 + register2).toUpperCase())))
            )
        );
      };
  }
}

function generateIndexCBFunctions(fn) {
  return function(register1, register2, register3) {
    if (register3 == undefined)
      return function(value, target, nextAddress) {
        // location = (getIYHIYL() + value) & 0xFFFF;
        // writeMem(location, rlc(readMem(location)));
        return [
          n.ExpressionStatement(n.AssignmentExpression('=', n.Identifier('location'),
              n.BinaryExpression('&', n.BinaryExpression('+',
              n.CallExpression('get' + (register1 + register2).toUpperCase()),
              n.Literal(value)),
              n.Literal(0xFFFF)))),
          n.ExpressionStatement(n.CallExpression('writeMem', [n.Identifier('location'), n.CallExpression(fn, o.READ_MEM8(n.Identifier('location')))]))
        ];
      };
    else
      return function(value, target, nextAddress) {
        // location = (getIYHIYL() + value) & 0xFFFF;
        // b = rlc(readMem(location));
        // writeMem(location, b);
        return [
          n.ExpressionStatement(n.AssignmentExpression('=', n.Identifier('location'),
              n.BinaryExpression('&', n.BinaryExpression('+',
              n.CallExpression('get' + (register1 + register2).toUpperCase()),
              n.Literal(value)),
              n.Literal(0xFFFF)))),
          n.ExpressionStatement(n.AssignmentExpression('=', n.Register(register3), n.CallExpression(fn, o.READ_MEM8(n.Identifier('location'))))),
          n.ExpressionStatement(n.CallExpression('writeMem', [n.Identifier('location'), n.Register(register3)]))
        ];
      };
  };
}

function evaluate(expression) {
  switch (expression.type) {
    case 'BinaryExpression':
      if (expression.left.type != 'Literal' && expression.right.type != 'Literal') {
        break;
      }
      switch (expression.operator) {
        case '>>':
          return n.Literal(expression.left.value >> expression.right.value);
          break;
        case '&':
          return n.Literal(expression.left.value & expression.right.value);
          break;
      }

      break;
  }

  return expression;
}
