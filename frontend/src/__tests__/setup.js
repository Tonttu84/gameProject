import '@testing-library/jest-dom'
import { beforeEach } from 'vitest'
import { resetAllStores } from '../stores'

beforeEach(() => {
  resetAllStores()
  window.localStorage.clear()
})
